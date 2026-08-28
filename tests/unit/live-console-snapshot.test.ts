import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeEvent } from "../../packages/domain/src";
import { createEvidence, EvidenceStore } from "../../packages/evidence/src";
import {
  buildLiveConsoleSnapshot,
  toLiveActivity,
} from "../../apps/server/src/live-service";
import { buildState, passCriterion } from "../fixtures/builders";

test("live console snapshot exposes only task-linked evidence and persisted specialist state", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passCriterion(state, store, "tests");
  state.plan.steps.push({
    id: "investigate-repository",
    objective: "Map the failure to repository code",
    dependencies: [],
    owner: "Repository Investigator",
    expectedEvidence: ["bounded repository findings"],
    riskCeiling: "READ_ONLY",
    status: "RUNNING",
    attempts: 1,
  });

  const unrelatedEvent: RuntimeEvent = {
    id: "event-unrelated",
    type: "TOOL_RESULT",
    source: "fixture",
    timestamp: "2026-08-25T19:45:00.000Z",
    payload: {},
  };
  store.recordEvent(unrelatedEvent);
  store.recordEvidence(
    createEvidence({
      id: "evidence-unrelated",
      kind: "VERIFICATION",
      sourceEventId: unrelatedEvent.id,
      sourceTool: "fixture",
      claim: "belongs to another task",
      outcome: "PASS",
      timestamp: "2026-08-25T19:45:01.000Z",
    }),
  );

  const snapshot = buildLiveConsoleSnapshot(state, store);
  assert.equal(snapshot.mode, "LIVE_TRUEFORGE");
  assert.deepEqual(
    snapshot.evidence.map((item) => item.id),
    ["evidence-tests"],
  );
  assert.equal(snapshot.specialists[0]?.name, "Repository Investigator");
  assert.equal(snapshot.specialists[0]?.status, "RUNNING");
  assert.equal(snapshot.specialists[1]?.status, "PENDING");
  assert.equal(snapshot.patch?.digest, state.patchDigest);
});

test("blocked live session produces an explicitly blocked timeline", () => {
  const state = buildState();
  state.phase = "BLOCKED";
  state.status = "BLOCKED";
  state.blockedReason = "runtime event could not be correlated";
  state.patchDigest = undefined;

  const snapshot = buildLiveConsoleSnapshot(state, new EvidenceStore());
  assert.equal(snapshot.blockedReason, "runtime event could not be correlated");
  assert.equal(snapshot.patch, undefined);
  assert.ok(snapshot.timeline.every((item) => item.status === "BLOCKED"));
  assert.equal(snapshot.activity.at(-1)?.tone, "BLOCKED");
});

test("malformed tool activity fails closed without exposing raw payload", () => {
  const activity = toLiveActivity(
    {
      id: "event-tool-response",
      type: "TOOL_RESULT",
      source: "trueforge:tool.response",
      timestamp: "2026-08-26T12:30:00.000Z",
      sequenceNumber: 42,
      payload: {
        content: "secret-token-and-untrusted-tool-output",
        toolCallId: "private-call-id",
      },
    },
    "INVESTIGATING",
  );

  assert.ok(activity);
  assert.equal(activity.tone, "ERROR");
  assert.equal(activity.label, "Tool response malformed");
  assert.equal(activity.sequenceNumber, 42);
  assert.doesNotMatch(JSON.stringify(activity), /secret-token|private-call-id/);
});

test("non-zero tool exit is rendered as ERROR", () => {
  const activity = toLiveActivity({
    id: "event-tool-failed",
    type: "TOOL_RESULT",
    source: "trueforge:tool.response",
    timestamp: "2026-08-26T12:31:00.000Z",
    payload: {
      content: JSON.stringify({ success: true, response: { exitCode: 2, result: "private" } }),
    },
  });
  assert.ok(activity);
  assert.equal(activity.tone, "ERROR");
  assert.equal(activity.label, "Tool execution failed");
  assert.doesNotMatch(JSON.stringify(activity), /private/);
});

test("cancelled turn activity reports a timeout without forwarding turn metrics", () => {
  const activity = toLiveActivity(
    {
      id: "event-turn-done",
      type: "TURN_DONE",
      source: "trueforge:turn.done",
      timestamp: "2026-08-26T12:30:00.000Z",
      payload: {
        state: {
          status: "cancelled",
          reason: "server-execution-timeout",
          metrics: { totalTokens: 1_000_000 },
        },
      },
    },
    "DEFINE_SUCCESS",
  );

  assert.ok(activity);
  assert.equal(activity.tone, "ERROR");
  assert.equal(activity.label, "TrueForge turn timed out");
  assert.doesNotMatch(JSON.stringify(activity), /totalTokens|1000000/);
});

test("errored turn activity is never presented as completion or allowed to leak details", () => {
  const activity = toLiveActivity(
    {
      id: "event-turn-error",
      type: "TURN_DONE",
      source: "trueforge:turn.done",
      timestamp: "2026-08-26T13:16:45.421Z",
      payload: {
        state: {
          status: "error",
          message: "max_tokens breached with secret-token",
          metrics: { totalOutputTokens: 59_045 },
        },
      },
    },
    "DEFINE_SUCCESS",
  );

  assert.ok(activity);
  assert.equal(activity.tone, "ERROR");
  assert.equal(activity.label, "TrueForge turn failed");
  assert.doesNotMatch(JSON.stringify(activity), /completed|max_tokens|secret-token|59045/i);
});

test("turn activity uses a finite fail-closed terminal-state mapping", () => {
  const cases = [
    { status: "done", tone: "SUCCESS", label: "TrueForge turn completed" },
    { status: "cancelled", tone: "WARNING", label: "TrueForge turn cancelled" },
    { status: "failed", tone: "ERROR", label: "TrueForge turn failed" },
    { status: "future", tone: "ERROR", label: "TrueForge turn ended with an unknown status" },
  ] as const;

  for (const candidate of cases) {
    const activity = toLiveActivity(
      {
        id: `event-${candidate.status}`,
        type: "TURN_DONE",
        source: "trueforge:turn.done",
        timestamp: "2026-08-26T13:20:00.000Z",
        payload: { state: { status: candidate.status } },
      },
      "DEFINE_SUCCESS",
    );
    assert.ok(activity);
    assert.equal(activity.tone, candidate.tone);
    assert.equal(activity.label, candidate.label);
  }
});

test("live snapshot rebuilds initial and sanitized activity from durable state", () => {
  const state = buildState();
  const store = new EvidenceStore();
  store.recordEvent({
    id: "event-sandbox-ready",
    type: "SANDBOX_CREATED",
    source: "trueforge:sandbox.created",
    timestamp: "2026-08-26T12:30:00.000Z",
    sequenceNumber: 9,
    payload: { sandboxId: "must-not-reach-the-browser" },
  });

  const snapshot = buildLiveConsoleSnapshot(state, store);

  assert.equal(snapshot.activity.length, 2);
  assert.equal(snapshot.activity[0]?.label, "Incident accepted by the control plane");
  assert.equal(snapshot.activity[1]?.label, "Daytona sandbox ready");
  assert.doesNotMatch(JSON.stringify(snapshot.activity), /must-not-reach-the-browser/);
});
