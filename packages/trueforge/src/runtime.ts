import { SessionState } from "../../domain/src/types";
import { EvidenceStore } from "../../evidence/src";
import { SessionStore } from "../../persistence/src";
import { EventJournal } from "../../telemetry/src";
import { TrueForgeSdkAdapter } from "./client";

export class DurableTrueForgeRuntime {
  public constructor(
    private readonly adapter: TrueForgeSdkAdapter,
    private readonly sessionStore: SessionStore,
    private readonly evidenceStore: EvidenceStore,
    private readonly journal: EventJournal,
    private readonly onEvent?: (event: import("../../domain/src/types").RuntimeEvent) => void | Promise<void>,
  ) {}

  public async start(state: SessionState, message: string): Promise<SessionState> {
    const sessionId = state.trueForgeSessionId ?? (await this.adapter.createSession());
    state.trueForgeSessionId = sessionId;
    await this.sessionStore.save(state);

    const result = await this.adapter.runTurn({
      sessionId,
      message,
      onEvent: async (event) => {
        this.evidenceStore.recordEvent(event);
        await this.journal.append(event);
        await this.onEvent?.(event);
        if (event.type === "TURN_CREATED") state.activeTurnId = readTurnId(event.payload) ?? state.activeTurnId;
        if (event.sequenceNumber !== undefined) state.lastSequenceNumber = event.sequenceNumber;
        await this.sessionStore.save(state);
      },
    });
    state.activeTurnId = result.turnId ?? state.activeTurnId;
    state.lastSequenceNumber = result.lastSequenceNumber;
    await this.sessionStore.save(state);
    return state;
  }

  public async resume(state: SessionState): Promise<SessionState> {
    if (
      state.trueForgeSessionId === undefined ||
      state.activeTurnId === undefined ||
      state.lastSequenceNumber === undefined
    ) {
      throw new Error("session cannot resume without persisted TrueForge session, turn, and sequence IDs");
    }
    const result = await this.adapter.resumeTurn(
      state.trueForgeSessionId,
      state.activeTurnId,
      state.lastSequenceNumber,
      async (event) => {
        if (this.evidenceStore.getEvent(event.id) === undefined) this.evidenceStore.recordEvent(event);
        await this.journal.append(event);
        await this.onEvent?.(event);
        if (event.sequenceNumber !== undefined) state.lastSequenceNumber = event.sequenceNumber;
        await this.sessionStore.save(state);
      },
    );
    state.lastSequenceNumber = result.lastSequenceNumber;
    await this.sessionStore.save(state);
    return state;
  }
}

function readTurnId(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const value = record.turnId ?? record.turn_id;
  return typeof value === "string" ? value : undefined;
}
