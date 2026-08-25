import { join } from "node:path";
import { createSessionState, createTask, RuntimeEvent, SessionState } from "../../../packages/domain/src";
import { EvidenceStore } from "../../../packages/evidence/src";
import { JsonSessionStore } from "../../../packages/persistence/src";
import { EventJournal } from "../../../packages/telemetry/src";
import {
  DurableTrueForgeRuntime,
  loadTrueForgeConfig,
  TrueForgeSdkAdapter,
} from "../../../packages/trueforge/src";
import { buildCiSuccessContract } from "../../../packages/workflow/src";
import { SseBroker } from "./sse-broker";

export interface StartLiveIncidentInput {
  repository: string;
  revision: string;
  runId: string;
  objective?: string;
}

export class LiveIncidentService {
  private readonly dataDirectory: string;
  private readonly sessionStore: JsonSessionStore;
  private readonly runtimes = new Map<string, DurableTrueForgeRuntime>();

  public constructor(private readonly broker: SseBroker, dataDirectory?: string) {
    this.dataDirectory = dataDirectory ?? process.env.EVIDENCEFORGE_DATA_DIR ?? ".data";
    this.sessionStore = new JsonSessionStore(join(this.dataDirectory, "sessions"));
  }

  public async start(input: StartLiveIncidentInput): Promise<SessionState> {
    validateInput(input);
    const task = createTask({
      objective: input.objective ?? `Resolve GitHub Actions run ${input.runId}`,
      repository: input.repository,
      revision: input.revision,
      runId: input.runId,
      constraints: [
        "GitHub MCP is authoritative",
        "repository code executes only in Daytona",
        "external writes require approval and reconciliation",
      ],
    });
    const state = createSessionState(task, buildCiSuccessContract(task));
    const runtime = this.createRuntime(task.id);
    this.runtimes.set(task.id, runtime);
    this.broker.publish("state", state);
    const started = await runtime.start(state, buildSupervisorMessage(input));
    this.broker.publish("state", started);
    return started;
  }

  public async resume(taskId: string): Promise<SessionState> {
    const state = await this.sessionStore.load(taskId);
    if (state === undefined) throw new Error(`no persisted session for ${taskId}`);
    const runtime = this.runtimes.get(taskId) ?? this.createRuntime(taskId);
    this.runtimes.set(taskId, runtime);
    const resumed = await runtime.resume(state);
    this.broker.publish("state", resumed);
    return resumed;
  }

  public async load(taskId: string): Promise<SessionState | undefined> {
    return this.sessionStore.load(taskId);
  }

  private createRuntime(taskId: string): DurableTrueForgeRuntime {
    const config = loadTrueForgeConfig();
    const adapter = new TrueForgeSdkAdapter(config);
    const evidenceStore = new EvidenceStore();
    const journal = new EventJournal(join(this.dataDirectory, "events", `${safe(taskId)}.jsonl`));
    return new DurableTrueForgeRuntime(
      adapter,
      this.sessionStore,
      evidenceStore,
      journal,
      async (event: RuntimeEvent) => this.broker.publish("runtime-event", event),
    );
  }
}

function buildSupervisorMessage(input: StartLiveIncidentInput): string {
  return `Investigate and resolve GitHub Actions run ${input.runId} in ${input.repository} at exact revision ${input.revision}.
First retrieve authoritative incident context through GitHub MCP and define the success contract. Then launch exactly the three configured read-only diagnostic specialists in parallel. Reproduce in Daytona before patching. Do not create a pull request until the application presents and approves the exact external action.`;
}

function validateInput(input: StartLiveIncidentInput): void {
  if (!/^[^/\s]+\/[^/\s]+$/.test(input.repository)) throw new Error("repository must be owner/name");
  if (input.revision.trim().length === 0) throw new Error("revision is required");
  if (input.runId.trim().length === 0) throw new Error("runId is required");
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
