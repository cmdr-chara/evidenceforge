import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ApprovalRequest, RuntimeEvent } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { JsonSessionStore } from "../../packages/persistence/src";
import { EventJournal } from "../../packages/telemetry/src";
import {
  DurableTrueForgeRuntime,
  RunTurnInput,
  StreamResult,
  TrueForgeRuntimeAdapter,
  TrueForgeStreamTimeoutError,
} from "../../packages/trueforge/src";
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
