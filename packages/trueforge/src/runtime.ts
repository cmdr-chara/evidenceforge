import { ApprovalRequest, digestCanonical, RuntimeEvent, SessionState } from "../../domain/src";
import { EvidenceStore } from "../../evidence/src";
import { isRuntimeCheckpointStore, SessionStore } from "../../persistence/src";
import { EventJournal } from "../../telemetry/src";
import {
  ApprovalResponse,
  RunTurnInput,
  StreamResult,
  TrueForgeSdkAdapter,
} from "./client";
import { TrueForgeEventProjector } from "./projector";
import { markEffectStarted, markEffectUncertain } from "../../workflow/src";
import {
  blockForDiagnosticViolation,
  DiagnosticContractGuard,
} from "./diagnostic-contract";

export interface TrueForgeRuntimeAdapter {
  createSession(): Promise<string>;
  cancelSession(sessionId: string): Promise<void>;
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
  private readonly projector: TrueForgeEventProjector;
  private readonly diagnosticGuard: DiagnosticContractGuard;
  private readonly cancelledSessions = new Set<string>();

  public constructor(
    private readonly adapter: TrueForgeRuntimeAdapter | TrueForgeSdkAdapter,
    private readonly sessionStore: SessionStore,
    private readonly evidenceStore: EvidenceStore,
    private readonly journal: EventJournal,
    private readonly onEvent?: (
      event: RuntimeEvent,
      state: SessionState,
    ) => void | Promise<void>,
    projector?: TrueForgeEventProjector,
  ) {
    this.projector = projector ?? new TrueForgeEventProjector(undefined, evidenceStore);
    this.diagnosticGuard = new DiagnosticContractGuard(evidenceStore.listEvents());
  }

  public async start(state: SessionState, message: string): Promise<SessionState> {
    const sessionId = state.trueForgeSessionId ?? (await this.adapter.createSession());
    state.trueForgeSessionId = sessionId;
    await this.persist(state);

    const result = await this.adapter.runTurn({
      sessionId,
      message,
      onEvent: async (event) => this.handleEvent(state, event),
    });
    applyStreamCursor(state, result);
    await this.persist(state);
    return state;
  }

  public async submitApproval(
    state: SessionState,
    approval: ApprovalRequest,
    decision: "APPROVED" | "DENIED",
    reason?: string,
  ): Promise<SessionState> {
    if (state.status !== "ACTIVE") {
      throw new Error("approval cannot be submitted for a non-active session");
    }
    if (state.trueForgeSessionId === undefined) {
      throw new Error("approval cannot be submitted without a TrueForge session ID");
    }
    const persistedApproval = state.approvals.find((candidate) => candidate.id === approval.id);
    if (persistedApproval === undefined) throw new Error(`unknown persisted approval ${approval.id}`);
    if (
      persistedApproval.action !== approval.action ||
      digestCanonical(persistedApproval.normalizedArguments) !==
        digestCanonical(approval.normalizedArguments)
    ) {
      throw new Error("submitted approval differs from persisted approval");
    }
    if (persistedApproval.toolCallId === undefined || persistedApproval.threadId === undefined) {
      throw new Error("approval is missing its TrueForge tool-call correlation");
    }
    if (persistedApproval.status !== decision) {
      throw new Error(`persisted approval status ${persistedApproval.status} does not match ${decision}`);
    }
    let startedOperationId: string | undefined;
    if (decision === "APPROVED" && persistedApproval.risk !== "READ_ONLY") {
      const provenance = persistedApproval.provenance;
      if (provenance === undefined) throw new Error("approved effect is missing approval provenance");
      const operation = state.operations.find(
        (candidate) => candidate.id === provenance.originatingOperationId,
      );
      if (
        provenance.actionDigest !== digestCanonical(persistedApproval.normalizedArguments) ||
        provenance.repository !== state.task.repository ||
        provenance.revision !== state.task.revision ||
        provenance.risk !== persistedApproval.risk ||
        provenance.consumedAt !== undefined ||
        Date.parse(provenance.expiresAt) <= Date.now() ||
        operation?.actionType !== persistedApproval.action ||
        operation.argumentDigest !== provenance.actionDigest
      ) {
        throw new Error("approval provenance is stale, substituted, expired, or consumed");
      }
      startedOperationId = operation.id;
      markEffectStarted(state, operation.id);
      provenance.consumedAt = new Date().toISOString();
      await this.persist(state);
    }
    this.restoreCorrelatedToolCalls(state);
    let result: StreamResult;
    try {
      result = await this.adapter.submitApprovals(
        state.trueForgeSessionId,
        [
          {
            threadId: persistedApproval.threadId,
            toolCallId: persistedApproval.toolCallId,
            decision: decision === "APPROVED" ? "allow" : "deny",
            reason,
          },
        ],
        async (event) => this.handleEvent(state, event),
      );
    } catch (error) {
      if (startedOperationId !== undefined) {
        const operation = state.operations.find((candidate) => candidate.id === startedOperationId);
        if (operation?.status === "EFFECT_STARTED") {
          markEffectUncertain(state, startedOperationId);
          await this.persist(state);
        }
      }
      throw error;
    }
    applyStreamCursor(state, result);
    await this.persist(state);
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
    await this.persist(state);
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
    if (!isNewEvent) return;
    this.evidenceStore.recordEvent(event);
    const violation = this.diagnosticGuard.observe(event);
    if (violation !== undefined) blockForDiagnosticViolation(state, violation);
    if (violation === undefined) this.projector.project(state, event);
    if (event.type === "TURN_CREATED") {
      state.activeTurnId = readTurnId(event.payload) ?? state.activeTurnId;
    }
    if (event.sequenceNumber !== undefined) state.lastSequenceNumber = event.sequenceNumber;
    await this.journal.append(event);
    await this.persist(state);
    if (violation !== undefined && state.trueForgeSessionId !== undefined) {
      await this.cancelOnce(state.trueForgeSessionId);
    }
    await this.onEvent?.(event, structuredClone(state));
  }

  private async cancelOnce(sessionId: string): Promise<void> {
    if (this.cancelledSessions.has(sessionId)) return;
    this.cancelledSessions.add(sessionId);
    try {
      await this.adapter.cancelSession(sessionId);
    } catch {
      // The durable BLOCKED state is authoritative even if the best-effort cancel races
      // with a terminal server event or the transport is unavailable.
    }
  }

  private async persist(state: SessionState): Promise<void> {
    if (isRuntimeCheckpointStore(this.sessionStore)) {
      await this.sessionStore.saveCheckpoint(state, this.evidenceStore);
      return;
    }
    await this.sessionStore.save(state);
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
