import { ApprovalRequest, RuntimeEvent, SessionState } from "../../domain/src/types";
import { EvidenceStore } from "../../evidence/src";
import { SessionStore } from "../../persistence/src";
import { EventJournal } from "../../telemetry/src";
import {
  ApprovalResponse,
  RunTurnInput,
  StreamResult,
  TrueForgeSdkAdapter,
} from "./client";
import { TrueForgeEventProjector } from "./projector";

export interface TrueForgeRuntimeAdapter {
  createSession(): Promise<string>;
  runTurn(input: RunTurnInput): Promise<StreamResult>;
  submitApprovals(
    sessionId: string,
    approvals: ApprovalResponse[],
    onEvent?: RunTurnInput["onEvent"],
  ): Promise<StreamResult>;
  resumeTurn(
    sessionId: string,
    turnId: string,
    afterSequenceNumber: number,
    onEvent?: RunTurnInput["onEvent"],
  ): Promise<StreamResult>;
}

export class DurableTrueForgeRuntime {
  public constructor(
    private readonly adapter: TrueForgeRuntimeAdapter | TrueForgeSdkAdapter,
    private readonly sessionStore: SessionStore,
    private readonly evidenceStore: EvidenceStore,
    private readonly journal: EventJournal,
    private readonly onEvent?: (
      event: RuntimeEvent,
      state: SessionState,
    ) => void | Promise<void>,
    private readonly projector = new TrueForgeEventProjector(),
  ) {}

  public async start(state: SessionState, message: string): Promise<SessionState> {
    const sessionId = state.trueForgeSessionId ?? (await this.adapter.createSession());
    state.trueForgeSessionId = sessionId;
    await this.sessionStore.save(state);

    const result = await this.adapter.runTurn({
      sessionId,
      message,
      onEvent: async (event) => this.handleEvent(state, event),
    });
    applyStreamCursor(state, result);
    await this.sessionStore.save(state);
    return state;
  }

  public async submitApproval(
    state: SessionState,
    approval: ApprovalRequest,
    decision: "APPROVED" | "DENIED",
    reason?: string,
  ): Promise<SessionState> {
    if (state.trueForgeSessionId === undefined) {
      throw new Error("approval cannot be submitted without a TrueForge session ID");
    }
    if (approval.toolCallId === undefined || approval.threadId === undefined) {
      throw new Error("approval is missing its TrueForge tool-call correlation");
    }
    if (approval.status !== decision) {
      throw new Error(`persisted approval status ${approval.status} does not match ${decision}`);
    }
    this.restoreCorrelatedToolCalls(state);
    const result = await this.adapter.submitApprovals(
      state.trueForgeSessionId,
      [
        {
          threadId: approval.threadId,
          toolCallId: approval.toolCallId,
          decision: decision === "APPROVED" ? "allow" : "deny",
          reason,
        },
      ],
      async (event) => this.handleEvent(state, event),
    );
    applyStreamCursor(state, result);
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
    this.restoreCorrelatedToolCalls(state);
    const result = await this.adapter.resumeTurn(
      state.trueForgeSessionId,
      state.activeTurnId,
      state.lastSequenceNumber,
      async (event) => this.handleEvent(state, event),
    );
    applyStreamCursor(state, result);
    await this.sessionStore.save(state);
    return state;
  }

  private restoreCorrelatedToolCalls(state: SessionState): void {
    for (const approval of state.approvals) {
      if (approval.toolCallId !== undefined && approval.threadId !== undefined) {
        this.projector.registerApprovalToolCall(approval);
      }
    }
  }

  private async handleEvent(state: SessionState, event: RuntimeEvent): Promise<void> {
    const isNewEvent = this.evidenceStore.getEvent(event.id) === undefined;
    if (isNewEvent) this.evidenceStore.recordEvent(event);
    this.projector.project(state, event);
    if (event.type === "TURN_CREATED") {
      state.activeTurnId = readTurnId(event.payload) ?? state.activeTurnId;
    }
    if (event.sequenceNumber !== undefined) state.lastSequenceNumber = event.sequenceNumber;
    if (isNewEvent) await this.journal.append(event);
    await this.sessionStore.save(state);
    if (isNewEvent) await this.onEvent?.(event, structuredClone(state));
  }
}

function applyStreamCursor(state: SessionState, result: StreamResult): void {
  state.activeTurnId = result.turnId ?? state.activeTurnId;
  state.lastSequenceNumber = result.lastSequenceNumber;
}

function readTurnId(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const value = record.turnId ?? record.turn_id;
  return typeof value === "string" ? value : undefined;
}
