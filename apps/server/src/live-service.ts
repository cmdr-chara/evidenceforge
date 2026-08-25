import { join, resolve } from "node:path";
import {
  ApprovalRequest,
  createSessionState,
  createTask,
  SessionState,
} from "../../../packages/domain/src";
import { EvidenceStore } from "../../../packages/evidence/src";
import { JsonSessionStore } from "../../../packages/persistence/src";
import { ApprovalPolicy } from "../../../packages/policies/src";
import { EventJournal } from "../../../packages/telemetry/src";
import {
  DurableTrueForgeRuntime,
  loadTrueForgeConfig,
  TrueForgeSdkAdapter,
} from "../../../packages/trueforge/src";
import { buildDefaultSuccessContract, SessionController } from "../../../packages/workflow/src";
import { SseBroker } from "./sse-broker";

export interface StartLiveIncidentInput {
  objective: string;
  repository: string;
  revision: string;
  runId: string;
  constraints?: string[];
}

export class LiveIncidentService {
  private readonly root = resolve(process.cwd(), ".evidenceforge");
  private readonly sessions = new JsonSessionStore(join(this.root, "sessions"));
  private readonly evidence = new EvidenceStore();
  private readonly journal = new EventJournal(join(this.root, "events.jsonl"));
  private readonly approvalPolicy = new ApprovalPolicy();

  public constructor(private readonly broker: SseBroker) {}

  public async start(input: StartLiveIncidentInput): Promise<SessionState> {
    const task = createTask({
      objective: input.objective,
      repository: input.repository,
      revision: input.revision,
      runId: input.runId,
      constraints: input.constraints,
    });
    const state = createSessionState(task, buildDefaultSuccessContract(task));
    await this.sessions.save(state);
    const runtime = this.createRuntime();
    const message = [
      `Investigate GitHub Actions run ${task.source.runId} for ${task.repository} at ${task.revision}.`,
      "Define the success contract before patching.",
      "Run exactly three read-only diagnostic specialists, reproduce in Daytona, patch serially, verify deterministically, review independently, and pause before creating a pull request.",
      "Do not claim completion; the application CompletionGate owns that decision.",
    ].join("\n");
    const updated = await runtime.start(state, message);
    this.broker.publish("live-state", updated);
    return updated;
  }

  public async resume(taskId: string): Promise<SessionState> {
    const state = await this.requireState(taskId);
    const updated = await this.createRuntime().resume(state);
    this.broker.publish("live-state", updated);
    return updated;
  }

  public async decideApproval(
    taskId: string,
    approvalId: string,
    decision: "APPROVED" | "DENIED",
  ): Promise<SessionState> {
    const state = await this.requireState(taskId);
    const existing = state.approvals.find((approval) => approval.id === approvalId);
    if (existing === undefined) throw new Error(`unknown approval request: ${approvalId}`);
    if (existing.status !== "PENDING") throw new Error(`approval ${approvalId} is already decided`);
    if (decision === "APPROVED") assertLiveApprovalReady(state, existing, this.approvalPolicy);

    const controller = new SessionController(state);
    let updated = controller.decideApproval(approvalId, decision);
    if (decision === "DENIED" && updated.status === "ACTIVE") {
      controller.replaceState(updated);
      updated = controller.transition("BLOCKED", "APPLICATION", `approval ${approvalId} was denied`);
    }
    await this.sessions.save(updated);

    const decided = updated.approvals.find((approval) => approval.id === approvalId);
    if (decided === undefined) throw new Error(`approval ${approvalId} disappeared after persistence`);
    updated = await this.createRuntime().submitApproval(
      updated,
      decided,
      decision,
      decision === "DENIED" ? "denied by EvidenceForge user" : undefined,
    );

    if (
      decision === "APPROVED" &&
      updated.status === "ACTIVE" &&
      updated.phase === "AWAITING_APPROVAL"
    ) {
      controller.replaceState(updated);
      updated = controller.transition(
        "PUBLISHING",
        "APPLICATION",
        `TrueForge accepted approval ${approvalId}`,
      );
      await this.sessions.save(updated);
    }
    this.broker.publish("live-state", updated);
    return updated;
  }

  public load(taskId: string): Promise<SessionState | undefined> {
    return this.sessions.load(taskId);
  }

  private async requireState(taskId: string): Promise<SessionState> {
    const state = await this.sessions.load(taskId);
    if (state === undefined) throw new Error(`unknown live task ${taskId}`);
    return state;
  }

  private createRuntime(): DurableTrueForgeRuntime {
    const config = loadTrueForgeConfig();
    return new DurableTrueForgeRuntime(
      new TrueForgeSdkAdapter(config),
      this.sessions,
      this.evidence,
      this.journal,
      (event) => this.broker.publish("runtime-event", event),
    );
  }
}

export function assertLiveApprovalReady(
  state: SessionState,
  approval: ApprovalRequest,
  policy = new ApprovalPolicy(),
): void {
  const authorization = policy.authorize({ ...approval, status: "APPROVED" });
  if (!authorization.allowed) throw new Error(authorization.reason);

  if (approval.risk !== "EXTERNAL_REVERSIBLE" && approval.risk !== "UNKNOWN") return;
  if (!/(^|\.)(create_pull_request)$/i.test(approval.action)) {
    throw new Error(`P0 live publishing supports only pull-request creation, not ${approval.action}`);
  }
  if (state.phase !== "AWAITING_APPROVAL") {
    throw new Error(`external approval requires AWAITING_APPROVAL, received ${state.phase}`);
  }
  const missing = state.successCriteria.filter(
    (criterion) =>
      criterion.required &&
      criterion.verifier.kind !== "EXTERNAL_STATE" &&
      criterion.status !== "PASS",
  );
  if (missing.length > 0) {
    throw new Error(`external approval blocked by criteria: ${missing.map((item) => item.id).join(", ")}`);
  }
  if (state.reviewerVerdict !== "PASS" && state.reviewerVerdict !== "PASS_WITH_WARNINGS") {
    throw new Error("external approval requires an independent reviewer PASS");
  }
  if (state.patchDigest === undefined) {
    throw new Error("external approval requires a recorded patch digest");
  }
}
