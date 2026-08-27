import { ApprovalRequest, digestCanonical, RuntimeEvent, SessionState } from "../../domain/src";
import { EvidenceStore } from "../../evidence/src";
import { isRuntimeCheckpointStore, SessionStore } from "../../persistence/src";
import { EventJournal } from "../../telemetry/src";
import { artifactBindingMatchesState } from "../../verification/src";
import {
  ApprovalResponse,
  RunTurnInput,
  StreamResult,
  TrueForgeSdkAdapter,
  TrueForgeStreamTimeoutError,
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
    generation?: StreamGeneration,
  ): Promise<StreamResult>;
  resumeTurn(
    sessionId: string,
    turnId: string,
    afterSequenceNumber: number,
    onEvent?: RunTurnInput["onEvent"],
    generation?: StreamGeneration,
  ): Promise<StreamResult>;
}

/**
 * A stream callback can outlive the Promise that consumed the stream (for
 * example, when the consumer's deadline wins a Promise.race). The callback
 * must therefore carry a generation owned by the runtime rather than relying
 * on the adapter to cancel a JavaScript Promise.
 */
class StreamGeneration {
  private open = true;
  private accepting = true;
  public readonly events: RuntimeEvent[] = [];
  public readonly diagnosticGuard: DiagnosticContractGuard;

  public constructor(events: RuntimeEvent[]) {
    this.diagnosticGuard = new DiagnosticContractGuard(events);
  }

  public close(): void {
    this.open = false;
    this.accepting = false;
  }

  public isOpen(): boolean {
    return this.open;
  }

  public stopAccepting(): void {
    this.accepting = false;
  }

  public accept(event: RuntimeEvent): boolean {
    if (!this.open || !this.accepting) return false;
    this.events.push(structuredClone(event));
    return true;
  }
}

export class DurableTrueForgeRuntime {
  private readonly projector: TrueForgeEventProjector;
  private readonly cancelledSessions = new Set<string>();
  private readonly applicationReducer?: (state: SessionState, event: RuntimeEvent) => void;
  private activeGeneration: StreamGeneration | undefined;

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
    applicationReducer?: (state: SessionState, event: RuntimeEvent) => void,
  ) {
    this.projector = projector ?? new TrueForgeEventProjector(undefined, evidenceStore);
    this.applicationReducer = applicationReducer;
  }

  public async start(state: SessionState, message: string): Promise<SessionState> {
    if (state.status !== "ACTIVE") throw new Error("non-active session cannot start a TrueForge turn");
    let sessionId: string;
    try {
      sessionId = state.trueForgeSessionId ?? (await this.adapter.createSession());
    } catch (error) {
      await this.failClosedStream(state, error);
      return state;
    }
    state.trueForgeSessionId = sessionId;
    await this.persist(state);

    const generation = this.beginGeneration(this.evidenceStore.listEvents());
    let result: StreamResult;
    try {
      result = await this.adapter.runTurn({
        sessionId,
        message,
        onEvent: async (event) => this.handleEvent(state, event, generation),
        generation,
      });
    } catch (error) {
      generation.close();
      await this.failClosedStream(state, error);
      return state;
    }
    generation.stopAccepting();
    try {
      await this.commitGeneration(state, generation);
    } catch (error) {
      generation.close();
      await this.failClosedStream(state, error);
      return state;
    }
    generation.close();
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
      const externalBindingInvalid =
        persistedApproval.risk === "EXTERNAL_REVERSIBLE" &&
        !artifactBindingMatchesState(provenance.binding, state, "EXTERNAL");
      if (
        provenance.actionDigest !== digestCanonical(persistedApproval.normalizedArguments) ||
        provenance.repository !== state.task.repository ||
        provenance.revision !== state.task.revision ||
        provenance.risk !== persistedApproval.risk ||
        provenance.consumedAt !== undefined ||
        Date.parse(provenance.expiresAt) <= Date.now() ||
        operation?.actionType !== persistedApproval.action ||
        operation.argumentDigest !== provenance.actionDigest ||
        externalBindingInvalid
      ) {
        throw new Error("approval provenance is stale, substituted, expired, or consumed");
      }
      startedOperationId = operation.id;
      markEffectStarted(state, operation.id);
      provenance.consumedAt = new Date().toISOString();
      await this.persist(state);
    }
    this.restoreCorrelatedToolCalls(state);
    const generation = this.beginGeneration(this.evidenceStore.listEvents());
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
        async (event) => this.handleEvent(state, event, generation),
        generation,
      );
    } catch (error) {
      generation.close();
      if (startedOperationId !== undefined) {
        const operation = state.operations.find((candidate) => candidate.id === startedOperationId);
        if (operation?.status === "EFFECT_STARTED") {
          markEffectUncertain(state, startedOperationId);
          await this.persist(state);
        }
      }
      await this.failClosedStream(state, error);
      return state;
    }
    generation.stopAccepting();
    try {
      await this.commitGeneration(state, generation);
    } catch (error) {
      generation.close();
      await this.failClosedStream(state, error);
      return state;
    }
    generation.close();
    applyStreamCursor(state, result);
    await this.persist(state);
    return state;
  }

  public async resume(state: SessionState): Promise<SessionState> {
    if (state.status !== "ACTIVE") throw new Error("terminal session cannot resume TrueForge");
    if (
      state.trueForgeSessionId === undefined ||
      state.activeTurnId === undefined ||
      state.lastSequenceNumber === undefined
    ) {
      throw new Error("session cannot resume without persisted TrueForge session, turn, and sequence IDs");
    }
    this.restoreCorrelatedToolCalls(state);
    const generation = this.beginGeneration(this.evidenceStore.listEvents());
    let result: StreamResult;
    try {
      result = await this.adapter.resumeTurn(
        state.trueForgeSessionId,
        state.activeTurnId,
        state.lastSequenceNumber,
        async (event) => this.handleEvent(state, event, generation),
        generation,
      );
    } catch (error) {
      generation.close();
      await this.failClosedStream(state, error);
      return state;
    }
    generation.stopAccepting();
    try {
      await this.commitGeneration(state, generation);
    } catch (error) {
      generation.close();
      await this.failClosedStream(state, error);
      return state;
    }
    generation.close();
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

  private beginGeneration(events: RuntimeEvent[]): StreamGeneration {
    this.activeGeneration?.close();
    const generation = new StreamGeneration(events);
    this.activeGeneration = generation;
    return generation;
  }

  private generationIsOpen(generation: StreamGeneration): boolean {
    return this.activeGeneration === generation && generation.isOpen();
  }

  private async handleEvent(
    state: SessionState,
    event: RuntimeEvent,
    generation: StreamGeneration,
  ): Promise<void> {
    if (state.status !== "ACTIVE" || !this.generationIsOpen(generation)) return;
    generation.accept(event);
  }

  private async commitGeneration(
    state: SessionState,
    generation: StreamGeneration,
  ): Promise<void> {
    if (!this.generationIsOpen(generation)) {
      throw new Error("TrueForge stream generation closed before commit");
    }

    for (const event of generation.events) {
      if (!this.generationIsOpen(generation)) {
        throw new Error("TrueForge stream generation closed during commit");
      }
      if (state.status !== "ACTIVE") break;
      if (!this.evidenceStore.recordEvent(event)) continue;

      const violation = generation.diagnosticGuard.observe(event);
      if (violation !== undefined) blockForDiagnosticViolation(state, violation);
      if (violation === undefined) this.projector.project(state, event);
      if (violation === undefined && state.status === "ACTIVE") {
        this.applicationReducer?.(state, event);
      }
      if (event.type === "TURN_CREATED" && state.status === "ACTIVE") {
        state.activeTurnId = readTurnId(event.payload) ?? state.activeTurnId;
      }
      if (event.sequenceNumber !== undefined) {
        state.lastSequenceNumber = Math.max(state.lastSequenceNumber ?? 0, event.sequenceNumber);
      }
      if (state.status !== "ACTIVE" && state.terminalSequenceNumber === undefined) {
        state.terminalSequenceNumber = event.sequenceNumber ?? state.lastSequenceNumber;
        if (state.terminalSequenceNumber !== undefined) {
          state.lastSequenceNumber = state.terminalSequenceNumber;
        }
      }

      if (!this.generationIsOpen(generation)) {
        throw new Error("TrueForge stream generation closed during commit");
      }
      await this.journal.append(event);
      if (!this.generationIsOpen(generation)) {
        throw new Error("TrueForge stream generation closed during commit");
      }
      await this.persist(state);
      if (!this.generationIsOpen(generation)) {
        throw new Error("TrueForge stream generation closed during commit");
      }
      if (state.status !== "ACTIVE" && state.trueForgeSessionId !== undefined) {
        await this.cancelOnce(state.trueForgeSessionId);
      }
      if (!this.generationIsOpen(generation)) {
        throw new Error("TrueForge stream generation closed during commit");
      }
      await this.onEvent?.(event, structuredClone(state));
    }
  }

  private async cancelOnce(sessionId: string): Promise<void> {
    if (this.cancelledSessions.has(sessionId)) return;
    this.cancelledSessions.add(sessionId);
    try {
      await this.adapter.cancelSession(sessionId);
    } catch {
      // The durable terminal state is authoritative even if best-effort cancellation races.
    }
  }

  private async failClosedStream(state: SessionState, error: unknown): Promise<void> {
    if (state.status === "ACTIVE") {
      state.phase = "BLOCKED";
      state.status = "BLOCKED";
      state.blockedReason =
        error instanceof TrueForgeStreamTimeoutError
          ? error.message
          : "TrueForge turn stream ended before a trustworthy terminal result";
      state.version += 1;
      state.terminalSequenceNumber ??= state.lastSequenceNumber;
    }
    await this.persist(state);
    if (state.trueForgeSessionId !== undefined) await this.cancelOnce(state.trueForgeSessionId);
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
  if (state.terminalSequenceNumber !== undefined) {
    state.lastSequenceNumber = state.terminalSequenceNumber;
    return;
  }
  state.lastSequenceNumber = Math.max(state.lastSequenceNumber ?? 0, result.lastSequenceNumber);
}

function readTurnId(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const value = record.turnId ?? record.turn_id;
  return typeof value === "string" ? value : undefined;
}
