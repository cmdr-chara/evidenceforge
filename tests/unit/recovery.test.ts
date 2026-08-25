import assert from "node:assert/strict";
import { test } from "node:test";
import { RecoveryPlanner } from "../../packages/workflow/src";

const emptyBudget = { transientAttempts: 0, patchAttempts: 0, replanAttempts: 0 };

test("semantic failures trigger replanning rather than blind retry", () => {
  const decision = new RecoveryPlanner().decide("SEMANTIC_FAILURE", emptyBudget);
  assert.equal(decision.action, "REPLAN");
  assert.equal(decision.nextPhase, "REPLANNING");
});

test("retry budget exhaustion transitions to ESCALATED", () => {
  const decision = new RecoveryPlanner().decide("TRANSIENT", {
    transientAttempts: 2,
    patchAttempts: 0,
    replanAttempts: 0,
  });
  assert.equal(decision.action, "ESCALATE");
  assert.equal(decision.nextPhase, "ESCALATED");
});

test("approval denial becomes BLOCKED", () => {
  const decision = new RecoveryPlanner().decide("POLICY_DENIED", emptyBudget);
  assert.equal(decision.nextPhase, "BLOCKED");
});

test("transient retries are bounded and back off", () => {
  const planner = new RecoveryPlanner();
  const first = planner.decide("TRANSIENT", emptyBudget);
  const second = planner.decide("TRANSIENT", first.budget);
  assert.equal(first.action, "RETRY");
  assert.equal(second.action, "RETRY");
  assert.ok((second.delayMs ?? 0) > (first.delayMs ?? 0));
});
