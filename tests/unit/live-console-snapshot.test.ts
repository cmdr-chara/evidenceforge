import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeEvent } from "../../packages/domain/src";
import { createEvidence, EvidenceStore } from "../../packages/evidence/src";
import { buildLiveConsoleSnapshot } from "../../apps/server/src/live-service";
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
});
