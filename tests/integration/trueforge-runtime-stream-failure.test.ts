import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ApprovalRequest,
  digestCanonical,
  RuntimeEvent,
  SessionState,
} from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import {
  JsonRuntimeCheckpointStore,
  JsonSessionStore,
} from "../../packages/persistence/src";
import { EventJournal } from "../../packages/telemetry/src";
import { artifactBindingFor } from "../../packages/verification/src";
import {
  DurableTrueForgeRuntime,
  ApprovalResponse,
  RunTurnInput,
  StreamResult,
  TrueForgeRuntimeAdapter,
  TrueForgeTerminalPersistenceError,
  TrueForgeStreamTimeoutError,
} from "../../packages/trueforge/src";
import { createOperationIntent } from "../../packages/workflow/src";
import { buildState } from "../fixtures/builders";

class FailingStreamAdapter implements TrueForgeRuntimeAdapter {
  public cancellations = 0;

  public async createSession(): Promise<string> {
    return "tf-stream-failure";
  }

  public async cancelSession(sessionId: string): Promise<void> {
    assert.equal(sessionId, "tf-stream-failure");
    this.cancellations += 1;
  }

  public async runTurn(_input: RunTurnInput): Promise<StreamResult> {
    throw new TrueForgeStreamTimeoutError(30);
  }

  public async submitApprovals(): Promise<StreamResult> {
    throw new Error("simulated approval stream disconnect");
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("simulated stream disconnect");
  }
}

class RetryingCancellationAdapter extends FailingStreamAdapter {
  public override cancellations = 0;

  public override async createSession(): Promise<string> {
    return "tf-retry-cancellation";
  }

  public override async cancelSession(sessionId: string): Promise<void> {
    assert.equal(sessionId, "tf-retry-cancellation");
    this.cancellations += 1;
    if (this.cancellations === 1) throw new Error("first cancellation failed");
  }
}

class SingleEventAdapter implements TrueForgeRuntimeAdapter {
  public async createSession(): Promise<string> {
    return "tf-application-reducer";
  }

  public async cancelSession(): Promise<void> {}

  public async runTurn(input: RunTurnInput): Promise<StreamResult> {
    const event: RuntimeEvent = {
      id: "turn-application-reducer",
      type: "TURN_CREATED",
      source: "trueforge:turn.created",
      timestamp: "2026-08-27T15:00:00.000Z",
      sequenceNumber: 1,
      payload: { type: "turn.created", turnId: "turn-application-reducer" },
    };
    await input.onEvent?.(event);
    return {
      sessionId: input.sessionId,
      turnId: "turn-application-reducer",
      lastSequenceNumber: 1,
      events: [event],
      paused: false,
      requiredActions: [],
    };
  }

  public async submitApprovals(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }
}

class SessionCreationFailureAdapter extends SingleEventAdapter {
  public override async createSession(): Promise<string> {
    throw new Error("secret authentication detail");
  }
}

class LateCallbackAdapter implements TrueForgeRuntimeAdapter {
  public cancellations = 0;
  private callback: (() => Promise<void>) | undefined;

  public async createSession(): Promise<string> {
    return "tf-late-callback";
  }

  public async cancelSession(sessionId: string): Promise<void> {
    assert.equal(sessionId, "tf-late-callback");
    this.cancellations += 1;
  }

  public async runTurn(input: RunTurnInput): Promise<StreamResult> {
    const event: RuntimeEvent = {
      id: "late-callback-event",
      type: "TURN_CREATED",
      source: "trueforge:turn.created",
      timestamp: "2026-08-27T15:00:00.000Z",
      sequenceNumber: 1,
      payload: { type: "turn.created", turnId: "late-callback-turn" },
    };
    this.callback = async () => {
      await input.onEvent?.(event);
    };
    // The adapter has already handed the callback to the stream consumer,
    // but the consumer's deadline wins before the callback is released.
    throw new TrueForgeStreamTimeoutError(30);
  }

  public async submitApprovals(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async releaseCallback(): Promise<void> {
    await this.callback?.();
  }
}

class CountingSessionStore extends JsonSessionStore {
  public readonly saves: SessionState[] = [];

  public override async save(state: SessionState): Promise<void> {
    this.saves.push(structuredClone(state));
    await super.save(state);
  }
}

class FinalApprovalPersistenceFailureStore extends CountingSessionStore {
  private calls = 0;

  public override async save(state: SessionState): Promise<void> {
    this.calls += 1;
    if (this.calls === 2) throw new Error("final approval checkpoint failed");
    await super.save(state);
  }
}

class BlockingJournal extends EventJournal {
  private resolveStarted!: () => void;
  private resolveRelease!: () => void;
  private readonly release = new Promise<void>((resolve) => {
    this.resolveRelease = resolve;
  });
  public readonly appendStarted = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });
  public appendCalls = 0;

  public constructor(
    journalPath: string,
    private readonly appendFailure?: Error,
  ) {
    super(journalPath);
  }

  public override async append(event: RuntimeEvent): Promise<void> {
    this.appendCalls += 1;
    this.resolveStarted();
    await this.release;
    if (this.appendFailure !== undefined) throw this.appendFailure;
    await super.append(event);
  }

  public releaseAppend(): void {
    this.resolveRelease();
  }
}

class CountingCheckpointStore extends JsonRuntimeCheckpointStore {
  public readonly checkpoints: SessionState[] = [];

  public override async saveCheckpoint(
    state: SessionState,
    evidenceStore: EvidenceStore,
  ): Promise<void> {
    this.checkpoints.push(structuredClone(state));
    await super.saveCheckpoint(state, evidenceStore);
  }
}

class InFlightStreamAdapter implements TrueForgeRuntimeAdapter {
  private resolveCrash!: () => void;
  public readonly checkpointObserved = new Promise<void>((resolve) => {
    this.resolveCrash = resolve;
  });

  public async createSession(): Promise<string> {
    return "tf-in-flight";
  }

  public async cancelSession(): Promise<void> {}

  public async runTurn(input: RunTurnInput): Promise<StreamResult> {
    const event: RuntimeEvent = {
      id: "in-flight-turn-created",
      type: "TURN_CREATED",
      source: "trueforge:turn.created",
      timestamp: "2026-08-27T15:00:00.000Z",
      sequenceNumber: 1,
      payload: { type: "turn.created", turnId: "in-flight-turn" },
    };
    await input.onEvent?.(event);
    this.resolveCrash();
    await new Promise<void>(() => undefined);
    return {
      sessionId: input.sessionId,
      turnId: "in-flight-turn",
      lastSequenceNumber: 1,
      events: [event],
      paused: false,
      requiredActions: [],
    };
  }

  public async submitApprovals(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }
}

class ResumeAfterCrashAdapter implements TrueForgeRuntimeAdapter {
  public async createSession(): Promise<string> {
    return "tf-resumed";
  }

  public async cancelSession(): Promise<void> {}

  public async runTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async submitApprovals(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async resumeTurn(
    sessionId: string,
    turnId: string,
    afterSequenceNumber: number,
    onEvent?: RunTurnInput["onEvent"],
  ): Promise<StreamResult> {
    const event: RuntimeEvent = {
      id: "in-flight-resume-message",
      type: "MODEL_MESSAGE",
      source: "trueforge:model.message",
      threadId: "main",
      timestamp: "2026-08-27T15:00:01.000Z",
      sequenceNumber: afterSequenceNumber + 1,
      payload: {
        type: "model.message",
        id: "in-flight-resume-message",
        threadId: "main",
        content: "resume",
      },
    };
    await onEvent?.(event);
    return {
      sessionId,
      turnId,
      lastSequenceNumber: event.sequenceNumber ?? afterSequenceNumber,
      events: [event],
      paused: false,
      requiredActions: [],
    };
  }
}

class MidPipelineTimeoutAdapter implements TrueForgeRuntimeAdapter {
  private callback: Promise<void> | undefined;
  private resolveFailure!: () => void;
  public readonly failureObserved = new Promise<void>((resolve) => {
    this.resolveFailure = resolve;
  });

  public constructor(private readonly journal: BlockingJournal) {}

  public async createSession(): Promise<string> {
    return "tf-mid-pipeline";
  }

  public cancellations = 0;

  public async cancelSession(sessionId: string): Promise<void> {
    assert.equal(sessionId, "tf-mid-pipeline");
    this.cancellations += 1;
  }

  public async runTurn(input: RunTurnInput): Promise<StreamResult> {
    const event: RuntimeEvent = {
      id: "mid-pipeline-event",
      type: "TURN_CREATED",
      source: "trueforge:turn.created",
      timestamp: "2026-08-27T15:00:00.000Z",
      sequenceNumber: 1,
      payload: { type: "turn.created", turnId: "mid-pipeline-turn" },
    };
    this.callback = input.onEvent?.(event) ?? Promise.resolve();
    await this.journal.appendStarted;
    this.resolveFailure();
    throw new TrueForgeStreamTimeoutError(30);
  }

  public async submitApprovals(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async releaseCallback(): Promise<void> {
    this.journal.releaseAppend();
    await this.callback;
  }
}

class NeverResolvingCheckpointStore extends JsonRuntimeCheckpointStore {
  public readonly snapshots: Array<{
    state: SessionState;
    evidence: ReturnType<EvidenceStore["export"]>;
  }> = [];
  private resolveStarted!: () => void;
  public readonly blockedCheckpointStarted = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });
  private calls = 0;

  public override async saveCheckpoint(
    state: SessionState,
    evidenceStore: EvidenceStore,
  ): Promise<void> {
    this.calls += 1;
    this.snapshots.push({
      state: structuredClone(state),
      evidence: evidenceStore.export(),
    });
    if (this.calls === 1) {
      await super.saveCheckpoint(state, evidenceStore);
      return;
    }
    if (this.calls === 2) this.resolveStarted();
    await new Promise<void>(() => undefined);
  }
}

class CheckpointHangAdapter implements TrueForgeRuntimeAdapter {
  public cancellations = 0;

  public constructor(private readonly checkpoints: NeverResolvingCheckpointStore) {}

  public async createSession(): Promise<string> {
    return "tf-checkpoint-hang";
  }

  public async cancelSession(sessionId: string): Promise<void> {
    assert.equal(sessionId, "tf-checkpoint-hang");
    this.cancellations += 1;
  }

  public async runTurn(input: RunTurnInput): Promise<StreamResult> {
    const event: RuntimeEvent = {
      id: "checkpoint-hang-event",
      type: "TURN_CREATED",
      source: "trueforge:turn.created",
      timestamp: "2026-08-27T15:00:00.000Z",
      sequenceNumber: 1,
      payload: { type: "turn.created", turnId: "checkpoint-hang-turn" },
    };
    // The adapter may emit without awaiting the callback. This leaves the
    // runtime's event commit waiting on the intentionally stuck checkpoint.
    void input.onEvent?.(event);
    await this.checkpoints.blockedCheckpointStarted;
    throw new TrueForgeStreamTimeoutError(30);
  }

  public async submitApprovals(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }
}

class ObserverHangAdapter implements TrueForgeRuntimeAdapter {
  public cancellations = 0;
  private resolveObserverStarted!: () => void;
  public readonly observerStarted = new Promise<void>((resolve) => {
    this.resolveObserverStarted = resolve;
  });

  public async createSession(): Promise<string> {
    return "tf-observer-hang";
  }

  public async cancelSession(sessionId: string): Promise<void> {
    assert.equal(sessionId, "tf-observer-hang");
    this.cancellations += 1;
  }

  public async runTurn(input: RunTurnInput): Promise<StreamResult> {
    const event: RuntimeEvent = {
      id: "observer-hang-event",
      type: "TURN_CREATED",
      source: "trueforge:turn.created",
      timestamp: "2026-08-27T15:00:00.000Z",
      sequenceNumber: 1,
      payload: { type: "turn.created", turnId: "observer-hang-turn" },
    };
    void input.onEvent?.(event);
    await this.observerStarted;
    throw new TrueForgeStreamTimeoutError(30);
  }

  public async submitApprovals(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public markObserverStarted(): void {
    this.resolveObserverStarted();
  }
}

class ApprovalDrainFailureAdapter implements TrueForgeRuntimeAdapter {
  public cancellations = 0;
  private resolveReady!: () => void;
  public readonly streamReady = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });

  public constructor(private readonly journal: BlockingJournal) {}

  public async createSession(): Promise<string> {
    return "tf-approval-drain";
  }

  public async cancelSession(sessionId: string): Promise<void> {
    assert.equal(sessionId, "tf-approval-drain");
    this.cancellations += 1;
  }

  public async runTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async submitApprovals(
    sessionId: string,
    _approvals: ApprovalResponse[],
    onEvent?: RunTurnInput["onEvent"],
  ): Promise<StreamResult> {
    const event: RuntimeEvent = {
      id: "approval-drain-failure-event",
      type: "TURN_CREATED",
      source: "trueforge:turn.created",
      timestamp: "2026-08-27T15:00:00.000Z",
      sequenceNumber: 1,
      payload: { type: "turn.created", turnId: "approval-drain-turn" },
    };
    const callback = onEvent?.(event);
    if (callback !== undefined) void Promise.resolve(callback).catch(() => undefined);
    await this.journal.appendStarted;
    this.resolveReady();
    return {
      sessionId,
      turnId: "approval-drain-turn",
      lastSequenceNumber: 1,
      events: [event],
      paused: false,
      requiredActions: [],
    };
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }
}

class ApprovalFinalPersistenceAdapter implements TrueForgeRuntimeAdapter {
  public cancellations = 0;

  public async createSession(): Promise<string> {
    return "tf-approval-final-persist";
  }

  public async cancelSession(sessionId: string): Promise<void> {
    assert.equal(sessionId, "tf-approval-final-persist");
    this.cancellations += 1;
  }

  public async runTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async submitApprovals(sessionId: string): Promise<StreamResult> {
    return {
      sessionId,
      turnId: "approval-final-persist-turn",
      lastSequenceNumber: 1,
      events: [],
      paused: false,
      requiredActions: [],
    };
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }
}

function addApprovedExternalOperation(state: SessionState): ApprovalRequest {
  const normalizedArguments = { head: "fix/demo" };
  state.operations.push(
    createOperationIntent({
      id: "operation-approval-drain",
      actionType: "github.create_pull_request",
      tool: "github.create_pull_request",
      normalizedArguments,
      repository: state.task.repository,
      revision: state.task.revision,
      risk: "EXTERNAL_REVERSIBLE",
      replayPolicy: "RECONCILE_FIRST",
      expectedEvidence: ["tool result"],
    }),
  );
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const approval: ApprovalRequest = {
    id: "approval-drain",
    action: "github.create_pull_request",
    normalizedArguments,
    risk: "EXTERNAL_REVERSIBLE",
    reason: "external write",
    reversible: true,
    status: "APPROVED",
    toolCallId: "call-approval-drain",
    threadId: "main",
    provenance: {
      actionDigest: digestCanonical(normalizedArguments),
      repository: state.task.repository,
      revision: state.task.revision,
      risk: "EXTERNAL_REVERSIBLE",
      originatingOperationId: "operation-approval-drain",
      binding: artifactBindingFor(state, "EXTERNAL"),
      issuedAt,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
  state.approvals.push(approval);
  return approval;
}

test("runtime durably blocks and cancels a timed-out initial TrueForge turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-stream-timeout-"));
  try {
    const adapter = new FailingStreamAdapter();
    const sessions = new JsonSessionStore(join(root, "sessions"));
    const state = buildState();
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      sessions,
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
    );

    const updated = await runtime.start(state, "investigate");

    assert.equal(updated.status, "BLOCKED");
    assert.equal(updated.phase, "BLOCKED");
    assert.equal(updated.blockedReason, "TrueForge turn stream exceeded the 30-second deadline");
    assert.equal(adapter.cancellations, 1);
    assert.equal((await sessions.load(state.task.id))?.status, "BLOCKED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime durably blocks an interrupted resumed TrueForge turn without leaking the error", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-stream-resume-"));
  try {
    const adapter = new FailingStreamAdapter();
    const sessions = new JsonSessionStore(join(root, "sessions"));
    const state = buildState();
    state.trueForgeSessionId = "tf-stream-failure";
    state.activeTurnId = "turn-running";
    state.lastSequenceNumber = 14;
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      sessions,
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
    );

    const updated = await runtime.resume(state);

    assert.equal(updated.status, "BLOCKED");
    assert.equal(
      updated.blockedReason,
      "TrueForge turn stream ended before a trustworthy terminal result",
    );
    assert.equal(updated.blockedReason?.includes("simulated"), false);
    assert.equal(updated.terminalSequenceNumber, 14);
    assert.equal(adapter.cancellations, 1);
    assert.equal((await sessions.load(state.task.id))?.status, "BLOCKED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime durably blocks when an approval response stream disconnects", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-approval-stream-"));
  try {
    const adapter = new FailingStreamAdapter();
    const sessions = new JsonSessionStore(join(root, "sessions"));
    const state = buildState();
    state.trueForgeSessionId = "tf-stream-failure";
    const approval: ApprovalRequest = {
      id: "approval-denied",
      action: "github.create_pull_request",
      normalizedArguments: { head: "fix/demo" },
      risk: "EXTERNAL_REVERSIBLE",
      reason: "external write",
      reversible: true,
      status: "DENIED",
      toolCallId: "call-pr",
      threadId: "main",
    };
    state.approvals.push(approval);
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      sessions,
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
    );

    const updated = await runtime.submitApproval(state, approval, "DENIED", "not authorized");

    assert.equal(updated.status, "BLOCKED");
    assert.equal(
      updated.blockedReason,
      "TrueForge turn stream ended before a trustworthy terminal result",
    );
    assert.equal(adapter.cancellations, 1);
    assert.equal((await sessions.load(state.task.id))?.status, "BLOCKED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime applies and persists the application reducer before publishing observer snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-application-reducer-"));
  try {
    const sessions = new JsonSessionStore(join(root, "sessions"));
    const state = buildState();
    const observedPhases: string[] = [];
    const runtime = new DurableTrueForgeRuntime(
      new SingleEventAdapter(),
      sessions,
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
      (_event, snapshot) => {
        observedPhases.push(snapshot.phase);
      },
      undefined,
      (current, event) => {
        assert.equal(event.id, "turn-application-reducer");
        current.phase = "PLANNING";
        current.version += 1;
      },
    );

    const updated = await runtime.start(state, "investigate");

    assert.equal(updated.phase, "PLANNING");
    assert.deepEqual(observedPhases, ["PLANNING"]);
    assert.equal((await sessions.load(state.task.id))?.phase, "PLANNING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime durably blocks when TrueForge session creation fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-session-create-failure-"));
  try {
    const sessions = new JsonSessionStore(join(root, "sessions"));
    const state = buildState();
    const runtime = new DurableTrueForgeRuntime(
      new SessionCreationFailureAdapter(),
      sessions,
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
    );

    const updated = await runtime.start(state, "investigate");

    assert.equal(updated.status, "BLOCKED");
    assert.equal(
      updated.blockedReason,
      "TrueForge turn stream ended before a trustworthy terminal result",
    );
    assert.equal(updated.blockedReason?.includes("secret"), false);
    assert.equal((await sessions.load(state.task.id))?.status, "BLOCKED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime fences a callback released after a timed-out stream", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-late-callback-"));
  try {
    const adapter = new LateCallbackAdapter();
    const sessions = new CountingSessionStore(join(root, "sessions"));
    const evidence = new EvidenceStore();
    const journal = new EventJournal(join(root, "events.jsonl"));
    const observed: RuntimeEvent[] = [];
    const state = buildState();
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      sessions,
      evidence,
      journal,
      (event) => {
        observed.push(event);
      },
    );

    const updated = await runtime.start(state, "investigate");
    const savesBeforeRelease = sessions.saves.length;
    const eventsBeforeRelease = evidence.listEvents();
    const journalBeforeRelease = await journal.readAll();
    const observedBeforeRelease = observed.length;

    assert.equal(updated.status, "BLOCKED");
    assert.equal(adapter.cancellations, 1);
    assert.equal(eventsBeforeRelease.length, 0);
    assert.equal(journalBeforeRelease.length, 0);

    await adapter.releaseCallback();

    assert.equal(evidence.listEvents().length, eventsBeforeRelease.length);
    assert.equal((await journal.readAll()).length, journalBeforeRelease.length);
    assert.equal(sessions.saves.length, savesBeforeRelease);
    assert.equal(observed.length, observedBeforeRelease);
    assert.equal(adapter.cancellations, 1);
    assert.equal((await sessions.load(state.task.id))?.status, "BLOCKED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime checkpoints an accepted turn before an in-flight stream can crash", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-in-flight-checkpoint-"));
  try {
    const adapter = new InFlightStreamAdapter();
    const checkpoints = new JsonRuntimeCheckpointStore(join(root, "checkpoints"));
    const evidence = new EvidenceStore();
    const state = buildState();
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      checkpoints,
      evidence,
      new EventJournal(join(root, "events.jsonl")),
    );

    // The adapter intentionally never returns after the first event. The
    // checkpoint observed here is the state a restarted process can resume.
    const startPromise = runtime.start(state, "investigate");
    await adapter.checkpointObserved;
    const checkpoint = await checkpoints.loadCheckpoint(state.task.id);
    assert.ok(checkpoint);
    assert.equal(checkpoint.state.status, "ACTIVE");
    assert.equal(checkpoint.state.activeTurnId, "in-flight-turn");
    assert.equal(checkpoint.state.lastSequenceNumber, 1);
    assert.deepEqual(
      checkpoint.evidenceStore.listEvents().map((event) => event.id),
      ["in-flight-turn-created"],
    );

    const resumed = await new DurableTrueForgeRuntime(
      new ResumeAfterCrashAdapter(),
      checkpoints,
      checkpoint.evidenceStore,
      new EventJournal(join(root, "events.jsonl")),
    ).resume(checkpoint.state);
    assert.equal(resumed.status, "ACTIVE");
    assert.equal(resumed.activeTurnId, "in-flight-turn");
    assert.equal(resumed.lastSequenceNumber, 2);
    const resumedCheckpoint = await checkpoints.loadCheckpoint(state.task.id);
    assert.ok(resumedCheckpoint);
    assert.equal(resumedCheckpoint.state.lastSequenceNumber, 2);
    assert.deepEqual(
      resumedCheckpoint.evidenceStore.listEvents().map((event) => event.id),
      ["in-flight-turn-created", "in-flight-resume-message"],
    );

    // Keep the simulated crashed process from retaining a rejected promise;
    // its no-handle wait is deliberately left pending until test teardown.
    void startPromise;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("late journal completion cannot admit an event after the timeout cutoff", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-mid-pipeline-timeout-"));
  try {
    const journal = new BlockingJournal(join(root, "events.jsonl"));
    const adapter = new MidPipelineTimeoutAdapter(journal);
    const checkpoints = new CountingCheckpointStore(join(root, "checkpoints"));
    const evidence = new EvidenceStore();
    const observed: RuntimeEvent[] = [];
    const state = buildState();
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      checkpoints,
      evidence,
      journal,
      (event) => {
        observed.push(event);
      },
    );

    const startPromise = runtime.start(state, "investigate");
    await adapter.failureObserved;
    // Let the rejected adapter turn reach the runtime catch, which closes the
    // generation and waits for the blocked journal operation to drain.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(journal.appendCalls, 1);
    assert.equal(checkpoints.checkpoints.length, 1);

    await adapter.releaseCallback();
    const updated = await startPromise;

    assert.equal(updated.status, "BLOCKED");
    assert.equal(updated.phase, "BLOCKED");
    assert.equal(updated.terminalSequenceNumber, undefined);
    assert.equal(updated.activeTurnId, undefined);
    assert.equal(adapter.cancellations, 1);
    assert.deepEqual(observed, []);
    assert.equal(journal.appendCalls, 1);
    assert.deepEqual(
      checkpoints.checkpoints.map((checkpoint) => checkpoint.status),
      ["ACTIVE", "BLOCKED"],
    );
    const finalCheckpoint = await checkpoints.loadCheckpoint(state.task.id);
    assert.ok(finalCheckpoint);
    assert.equal(finalCheckpoint.state.status, "BLOCKED");
    assert.equal(finalCheckpoint.state.terminalSequenceNumber, undefined);
    assert.deepEqual(finalCheckpoint.evidenceStore.listEvents(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime still writes the terminal checkpoint when an in-flight journal fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-mid-pipeline-journal-failure-"));
  try {
    const journal = new BlockingJournal(
      join(root, "events.jsonl"),
      new Error("simulated journal failure"),
    );
    const adapter = new MidPipelineTimeoutAdapter(journal);
    const checkpoints = new CountingCheckpointStore(join(root, "checkpoints"));
    const evidence = new EvidenceStore();
    const observed: RuntimeEvent[] = [];
    const state = buildState();
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      checkpoints,
      evidence,
      journal,
      (event) => {
        observed.push(event);
      },
    );

    const startPromise = runtime.start(state, "investigate");
    await adapter.failureObserved;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(checkpoints.checkpoints.length, 1);

    await assert.rejects(adapter.releaseCallback(), /simulated journal failure/);
    const updated = await startPromise;

    assert.equal(updated.status, "BLOCKED");
    assert.equal(updated.phase, "BLOCKED");
    assert.equal(updated.blockedReason, "TrueForge turn stream exceeded the 30-second deadline");
    assert.equal(updated.terminalSequenceNumber, undefined);
    assert.equal(updated.activeTurnId, undefined);
    assert.equal(adapter.cancellations, 1);
    assert.deepEqual(observed, []);
    assert.equal(journal.appendCalls, 1);
    assert.deepEqual(
      checkpoints.checkpoints.map((checkpoint) => checkpoint.status),
      ["ACTIVE", "BLOCKED"],
    );
    const finalCheckpoint = await checkpoints.loadCheckpoint(state.task.id);
    assert.ok(finalCheckpoint);
    assert.equal(finalCheckpoint.state.status, "BLOCKED");
    assert.equal(finalCheckpoint.state.terminalSequenceNumber, undefined);
    assert.deepEqual(finalCheckpoint.evidenceStore.listEvents(), []);
    assert.deepEqual(await journal.readAll(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime terminalizes and cancels when an in-flight journal never settles", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-never-journal-"));
  try {
    const journal = new BlockingJournal(join(root, "events.jsonl"));
    const adapter = new MidPipelineTimeoutAdapter(journal);
    const checkpoints = new CountingCheckpointStore(join(root, "checkpoints"));
    const state = buildState();
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      checkpoints,
      new EvidenceStore(),
      journal,
      undefined,
      undefined,
      undefined,
      { drainTimeoutMs: 250 },
    );

    const startedAt = Date.now();
    const startPromise = runtime.start(state, "investigate");
    await adapter.failureObserved;
    const updated = await startPromise;

    assert.ok(Date.now() - startedAt < 2_000);
    assert.equal(updated.status, "BLOCKED");
    assert.equal(adapter.cancellations, 1);
    assert.deepEqual(
      checkpoints.checkpoints.map((checkpoint) => checkpoint.status),
      ["ACTIVE", "BLOCKED"],
    );
    const finalCheckpoint = await checkpoints.loadCheckpoint(state.task.id);
    assert.ok(finalCheckpoint);
    assert.equal(finalCheckpoint.state.status, "BLOCKED");
    assert.deepEqual(finalCheckpoint.evidenceStore.listEvents(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime reports an undurable terminal checkpoint instead of returning false BLOCKED", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-never-checkpoint-"));
  try {
    const checkpoints = new NeverResolvingCheckpointStore(join(root, "checkpoints"));
    const adapter = new CheckpointHangAdapter(checkpoints);
    const state = buildState();
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      checkpoints,
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
      undefined,
      undefined,
      undefined,
      { drainTimeoutMs: 250 },
    );

    const startedAt = Date.now();
    await assert.rejects(
      runtime.start(state, "investigate"),
      TrueForgeTerminalPersistenceError,
    );

    assert.ok(Date.now() - startedAt < 2_000);
    assert.equal(state.status, "BLOCKED");
    assert.equal(adapter.cancellations, 1);
    assert.equal(checkpoints.snapshots[0]?.state.status, "ACTIVE");
    assert.equal(checkpoints.snapshots[1]?.state.status, "ACTIVE");
    assert.equal(checkpoints.snapshots.at(-1)?.state.status, "BLOCKED");
    const durable = await checkpoints.loadCheckpoint(state.task.id);
    assert.ok(durable);
    assert.equal(durable.state.status, "ACTIVE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime retries provider cancellation after a failed attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-cancel-retry-"));
  try {
    const adapter = new RetryingCancellationAdapter();
    const sessions = new JsonSessionStore(join(root, "sessions"));
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      sessions,
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
    );
    const first = buildState();
    first.trueForgeSessionId = "tf-retry-cancellation";
    const second = buildState();
    second.trueForgeSessionId = "tf-retry-cancellation";

    await runtime.start(first, "first attempt");
    await runtime.start(second, "retry cancellation");

    assert.equal(first.status, "BLOCKED");
    assert.equal(second.status, "BLOCKED");
    assert.equal(adapter.cancellations, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime terminalizes and cancels when an observer never settles", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-never-observer-"));
  try {
    const adapter = new ObserverHangAdapter();
    const checkpoints = new CountingCheckpointStore(join(root, "checkpoints"));
    const evidence = new EvidenceStore();
    const state = buildState();
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      checkpoints,
      evidence,
      new EventJournal(join(root, "events.jsonl")),
      async () => {
        adapter.markObserverStarted();
        await new Promise<void>(() => undefined);
      },
      undefined,
      undefined,
      { drainTimeoutMs: 250 },
    );

    const startedAt = Date.now();
    const updated = await runtime.start(state, "investigate");

    assert.ok(Date.now() - startedAt < 2_000);
    assert.equal(updated.status, "BLOCKED");
    assert.equal(adapter.cancellations, 1);
    assert.deepEqual(
      checkpoints.checkpoints.map((checkpoint) => checkpoint.status),
      ["ACTIVE", "ACTIVE", "BLOCKED"],
    );
    const finalCheckpoint = await checkpoints.loadCheckpoint(state.task.id);
    assert.ok(finalCheckpoint);
    assert.equal(finalCheckpoint.state.status, "BLOCKED");
    assert.deepEqual(
      finalCheckpoint.evidenceStore.listEvents().map((event) => event.id),
      ["observer-hang-event"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval drain failure marks an effect uncertain before terminal persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-approval-drain-"));
  try {
    const journal = new BlockingJournal(
      join(root, "events.jsonl"),
      new Error("approval journal failed"),
    );
    const adapter = new ApprovalDrainFailureAdapter(journal);
    const sessions = new CountingSessionStore(join(root, "sessions"));
    const state = buildState();
    state.trueForgeSessionId = "tf-approval-drain";
    const approval = addApprovedExternalOperation(state);
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      sessions,
      new EvidenceStore(),
      journal,
      undefined,
      undefined,
      undefined,
      { drainTimeoutMs: 15 },
    );

    const approvalPromise = runtime.submitApproval(state, approval, "APPROVED");
    await adapter.streamReady;
    journal.releaseAppend();
    const updated = await approvalPromise;

    assert.equal(updated.status, "BLOCKED");
    assert.equal(updated.operations[0]?.status, "EFFECT_UNCERTAIN");
    assert.equal(adapter.cancellations, 1);
    assert.deepEqual(
      sessions.saves.map((snapshot) => snapshot.operations[0]?.status),
      ["EFFECT_STARTED", "EFFECT_UNCERTAIN"],
    );
    assert.equal(sessions.saves.at(-1)?.status, "BLOCKED");
    assert.deepEqual(await journal.readAll(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval final persistence failure marks an effect uncertain before blocking", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-approval-final-persist-"));
  try {
    const adapter = new ApprovalFinalPersistenceAdapter();
    const sessions = new FinalApprovalPersistenceFailureStore(join(root, "sessions"));
    const state = buildState();
    state.trueForgeSessionId = "tf-approval-final-persist";
    const approval = addApprovedExternalOperation(state);
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      sessions,
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
      undefined,
      undefined,
      undefined,
      { drainTimeoutMs: 15 },
    );

    const updated = await runtime.submitApproval(state, approval, "APPROVED");

    assert.equal(updated.status, "BLOCKED");
    assert.equal(updated.operations[0]?.status, "EFFECT_UNCERTAIN");
    assert.equal(adapter.cancellations, 1);
    assert.deepEqual(
      sessions.saves.map((snapshot) => [snapshot.status, snapshot.operations[0]?.status]),
      [
        ["ACTIVE", "EFFECT_STARTED"],
        ["BLOCKED", "EFFECT_UNCERTAIN"],
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
