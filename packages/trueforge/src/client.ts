import { RuntimeEvent } from "../../domain/src/types";
import { buildEvidenceForgeAgentSpec } from "./agent-spec";
import { TrueForgeRuntimeConfig } from "./config";
import { normalizeTrueForgeEvent } from "./event-normalizer";

type UnknownRecord = Record<string, unknown>;

interface MetadataItem {
  data: unknown;
  id?: string;
}

interface MetadataStream {
  withMetadata(): AsyncIterable<MetadataItem>;
}

interface SessionApi {
  create(input: unknown): Promise<{ data: { id: string } }>;
  cancel(sessionId: string): Promise<unknown>;
  createTurnStream(sessionId: string, input: unknown): Promise<MetadataStream>;
  getTurn(sessionId: string, turnId: string): Promise<{ data: UnknownRecord }>;
  subscribeToTurn(
    sessionId: string,
    turnId: string,
    query: { afterSequenceNumber?: number },
    options?: { timeoutInSeconds?: number },
  ): Promise<MetadataStream>;
  listTurnEvents(sessionId: string, turnId: string, query?: unknown): Promise<AsyncIterable<unknown>>;
}

interface TrueForgeClientShape {
  sessions: SessionApi;
}

interface TrueForgeConstructor {
  new (options: { baseUrl: string; token?: string; timeoutInSeconds?: number }): TrueForgeClientShape;
}

interface TrueForgeModuleShape {
  TrueForge: TrueForgeConstructor;
}

export interface StreamResult {
  sessionId: string;
  turnId?: string;
  lastSequenceNumber: number;
  events: RuntimeEvent[];
  paused: boolean;
  requiredActions: unknown[];
}

export interface RunTurnInput {
  sessionId: string;
  message: string;
  onEvent?: (event: RuntimeEvent) => void | Promise<void>;
}

export interface ApprovalResponse {
  threadId: string;
  toolCallId: string;
  decision: "allow" | "deny";
  reason?: string;
}

export class TrueForgeSdkAdapter {
  private clientPromise: Promise<TrueForgeClientShape> | undefined;

  public constructor(private readonly config: TrueForgeRuntimeConfig) {}

  public async createSession(): Promise<string> {
    const client = await this.client();
    const { data } = await client.sessions.create({
      agent: { spec: buildEvidenceForgeAgentSpec(this.config) },
    });
    return data.id;
  }

  public async cancelSession(sessionId: string): Promise<void> {
    const client = await this.client();
    await client.sessions.cancel(sessionId);
  }

  public async runTurn(input: RunTurnInput): Promise<StreamResult> {
    const client = await this.client();
    const stream = await client.sessions.createTurnStream(input.sessionId, {
      input: [{ type: "user.message", content: input.message }],
    });
    return this.consume(input.sessionId, stream, input.onEvent);
  }

  public async submitApprovals(
    sessionId: string,
    approvals: ApprovalResponse[],
    onEvent?: RunTurnInput["onEvent"],
  ): Promise<StreamResult> {
    const client = await this.client();
    const stream = await client.sessions.createTurnStream(sessionId, {
      input: approvals.map((approval) => ({
        type: "user.tool_approval",
        threadId: approval.threadId,
        toolCallId: approval.toolCallId,
        approval:
          approval.decision === "allow"
            ? { status: "allow" }
            : { status: "deny", reason: approval.reason ?? "denied by user" },
      })),
    });
    return this.consume(sessionId, stream, onEvent);
  }

  public async resumeTurn(
    sessionId: string,
    turnId: string,
    afterSequenceNumber: number,
    onEvent?: RunTurnInput["onEvent"],
  ): Promise<StreamResult> {
    const client = await this.client();
    const { data: turn } = await client.sessions.getTurn(sessionId, turnId);
    const state = asRecord(turn.state);
    if (state.status === "running") {
      const stream = await client.sessions.subscribeToTurn(
        sessionId,
        turnId,
        { afterSequenceNumber },
        { timeoutInSeconds: this.config.timeoutInSeconds },
      );
      return this.consume(sessionId, stream, onEvent, afterSequenceNumber, turnId);
    }

    const events: RuntimeEvent[] = [];
    let lastSequenceNumber = afterSequenceNumber;
    for await (const raw of await client.sessions.listTurnEvents(sessionId, turnId, { order: "asc" })) {
      const record = asRecord(raw);
      const sequence = readSequence(record);
      if (sequence !== undefined) {
        lastSequenceNumber = Math.max(lastSequenceNumber, sequence);
        if (sequence <= afterSequenceNumber) continue;
      }
      const normalized = normalizeTrueForgeEvent(raw, sequence);
      events.push(normalized.event);
      await onEvent?.(normalized.event);
    }
    return {
      sessionId,
      turnId,
      lastSequenceNumber,
      events,
      paused:
        state.status === "done" &&
        Array.isArray(state.requiredActions) &&
        state.requiredActions.length > 0,
      requiredActions: Array.isArray(state.requiredActions) ? state.requiredActions : [],
    };
  }

  private async consume(
    sessionId: string,
    stream: MetadataStream,
    onEvent?: RunTurnInput["onEvent"],
    initialSequence = 0,
    knownTurnId?: string,
  ): Promise<StreamResult> {
    let lastSequenceNumber = initialSequence;
    let turnId = knownTurnId;
    const events: RuntimeEvent[] = [];
    let requiredActions: unknown[] = [];

    for await (const item of stream.withMetadata()) {
      const sequence = item.id === undefined ? undefined : Number.parseInt(item.id, 10);
      if (sequence !== undefined && Number.isFinite(sequence)) {
        lastSequenceNumber = Math.max(lastSequenceNumber, sequence);
      }
      const normalized = normalizeTrueForgeEvent(item.data, sequence);
      events.push(normalized.event);
      const raw = asRecord(item.data);
      if (raw.type === "turn.created") {
        turnId = readString(raw, "turnId") ?? readString(raw, "turn_id") ?? turnId;
      }
      if (raw.type === "turn.done") {
        const state = asRecord(raw.state);
        if (Array.isArray(state.requiredActions)) requiredActions = state.requiredActions;
      }
      await onEvent?.(normalized.event);
    }

    return {
      sessionId,
      turnId,
      lastSequenceNumber,
      events,
      paused: requiredActions.length > 0,
      requiredActions,
    };
  }

  private async client(): Promise<TrueForgeClientShape> {
    this.clientPromise ??= loadClient(this.config);
    return this.clientPromise;
  }
}

async function loadClient(config: TrueForgeRuntimeConfig): Promise<TrueForgeClientShape> {
  const packageName = "@truefoundry/trueforge-sdk";
  let module: TrueForgeModuleShape;
  try {
    module = (await import(packageName)) as TrueForgeModuleShape;
  } catch (error) {
    throw new Error(
      `Unable to load ${packageName}. Run pnpm install before live TrueForge use. Cause: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return new module.TrueForge({
    baseUrl: config.baseUrl,
    token: config.token,
    timeoutInSeconds: config.timeoutInSeconds,
  });
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readSequence(record: UnknownRecord): number | undefined {
  for (const key of ["sequenceNumber", "sequence_number", "sequence"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}
