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

export class TrueForgeStreamTimeoutError extends Error {
  public constructor(timeoutInSeconds: number) {
    super(`TrueForge turn stream exceeded the ${timeoutInSeconds}-second deadline`);
    this.name = "TrueForgeStreamTimeoutError";
  }
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
  generation?: StreamGeneration;
}

/**
 * A runtime-owned lifetime for callbacks spawned by one TrueForge stream.
 * Closing the generation does not cancel JavaScript promises, but it gives
 * the callback owner a durable, shared cutoff to check before side effects.
 */
export interface StreamGeneration {
  isOpen(): boolean;
  close(): void;
}

export interface ApprovalResponse {
  threadId: string;
  toolCallId: string;
  decision: "allow" | "deny";
  reason?: string;
}

export interface ReplayedTurnEvents {
  events: RuntimeEvent[];
  lastSequenceNumber: number;
}

export async function replayListedTurnEvents(
  rawEvents: AsyncIterable<unknown>,
  afterSequenceNumber: number,
  onEvent?: RunTurnInput["onEvent"],
  timeoutInSeconds?: number,
  generation?: StreamGeneration,
): Promise<ReplayedTurnEvents> {
  const events: RuntimeEvent[] = [];
  let lastSequenceNumber = afterSequenceNumber;
  const iterator = rawEvents[Symbol.asyncIterator]();
  const deadline = deadlineFor(timeoutInSeconds);
  try {
    while (true) {
      if (generation !== undefined && !generation.isOpen()) break;
      const next = await runBeforeDeadline(
        () => iterator.next(),
        deadline,
        timeoutInSeconds,
      );
      if (next.done) break;
      const raw = next.value;
      const record = asRecord(raw);
      const sequence = readSequence(record);
      if (sequence !== undefined) {
        lastSequenceNumber = Math.max(lastSequenceNumber, sequence);
        if (sequence <= afterSequenceNumber) continue;
      }
      const normalized = normalizeTrueForgeEvent(raw, sequence);
      events.push(normalized.event);
      if (generation !== undefined && !generation.isOpen()) break;
      await runBeforeDeadline(
        () => onEvent?.(normalized.event),
        deadline,
        timeoutInSeconds,
      );
    }
  } catch (error) {
    generation?.close();
    throw error;
  } finally {
    closeIterator(iterator);
  }
  return { events, lastSequenceNumber };
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
    return this.consume(input.sessionId, stream, input.onEvent, 0, undefined, input.generation);
  }

  public async submitApprovals(
    sessionId: string,
    approvals: ApprovalResponse[],
    onEvent?: RunTurnInput["onEvent"],
    generation?: StreamGeneration,
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
    return this.consume(sessionId, stream, onEvent, 0, undefined, generation);
  }

  public async resumeTurn(
    sessionId: string,
    turnId: string,
    afterSequenceNumber: number,
    onEvent?: RunTurnInput["onEvent"],
    generation?: StreamGeneration,
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
      return this.consume(sessionId, stream, onEvent, afterSequenceNumber, turnId, generation);
    }

    const replay = await replayListedTurnEvents(
      await client.sessions.listTurnEvents(sessionId, turnId, { order: "asc" }),
      afterSequenceNumber,
      onEvent,
      this.config.timeoutInSeconds,
      generation,
    );
    return {
      sessionId,
      turnId,
      lastSequenceNumber: replay.lastSequenceNumber,
      events: replay.events,
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
    generation?: StreamGeneration,
  ): Promise<StreamResult> {
    return consumeMetadataStream({
      sessionId,
      stream,
      timeoutInSeconds: this.config.timeoutInSeconds,
      onEvent,
      initialSequence,
      knownTurnId,
      generation,
    });
  }

  private async client(): Promise<TrueForgeClientShape> {
    this.clientPromise ??= loadClient(this.config);
    return this.clientPromise;
  }
}

export async function consumeMetadataStream(input: {
  sessionId: string;
  stream: MetadataStream;
  timeoutInSeconds: number;
  onEvent?: RunTurnInput["onEvent"];
  initialSequence?: number;
  knownTurnId?: string;
  generation?: StreamGeneration;
}): Promise<StreamResult> {
    const {
      sessionId,
      stream,
      timeoutInSeconds,
      onEvent,
      initialSequence = 0,
      knownTurnId,
      generation,
    } = input;
    let lastSequenceNumber = initialSequence;
    let turnId = knownTurnId;
    const events: RuntimeEvent[] = [];
    let requiredActions: unknown[] = [];
    const iterator = stream.withMetadata()[Symbol.asyncIterator]();
    const deadline = deadlineFor(timeoutInSeconds);

    try {
      while (true) {
        if (generation !== undefined && !generation.isOpen()) break;
        const next = await runBeforeDeadline(
          () => iterator.next(),
          deadline,
          timeoutInSeconds,
        );
        if (next.done) break;
        const item = next.value;
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
        if (generation !== undefined && !generation.isOpen()) break;
        await runBeforeDeadline(
          () => onEvent?.(normalized.event),
          deadline,
          timeoutInSeconds,
        );
      }
    } catch (error) {
      generation?.close();
      throw error;
    } finally {
      closeIterator(iterator);
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

function closeIterator<T>(iterator: AsyncIterator<T>): void {
  try {
    const result = iterator.return?.();
    if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
  } catch {
    // The stream deadline remains authoritative when best-effort iterator cleanup fails.
  }
}

function deadlineFor(timeoutInSeconds: number | undefined): number {
  return timeoutInSeconds === undefined
    ? Number.POSITIVE_INFINITY
    : Date.now() + timeoutInSeconds * 1_000;
}

async function runBeforeDeadline<T>(
  operation: () => T | PromiseLike<T>,
  deadline: number,
  timeoutInSeconds: number | undefined,
): Promise<T> {
  if (timeoutInSeconds === undefined) return operation();
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new TrueForgeStreamTimeoutError(timeoutInSeconds);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new TrueForgeStreamTimeoutError(timeoutInSeconds)),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
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
