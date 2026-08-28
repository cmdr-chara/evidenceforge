import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceStore } from "../../packages/evidence/src";
import { ProgressEvaluator, StopGuard } from "../../packages/verification/src";
import { buildState, passAll, passCriterion } from "../fixtures/builders";

test("round evaluation lists PASS, missing evidence, and the next admissible action", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passCriterion(state, store, "failure-reproduced");
  const evaluation = new ProgressEvaluator(store).evaluate(state, "PATCH");
  assert.equal(
    evaluation.criteria.find((criterion) => criterion.criterionId === "failure-reproduced")?.status,
    "PASS",
  );
  assert.equal(evaluation.nextAction, "VERIFY");
  assert.ok(evaluation.missingEvidence.some((item) => item.startsWith("tests:")));
});

test("supervisor allows natural success only when a certificate is issuable", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passAll(state, store);
  const decision = new StopGuard(store).evaluateNaturalStop(state);
  assert.equal(decision.successful, true);
  if (decision.successful) assert.equal(decision.certificate.taskId, state.task.id);
});

test("deterministic verifier failure routes replan despite reviewer PASS", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passAll(state, store);
  const tests = state.successCriteria.find((criterion) => criterion.id === "tests")!;
  tests.status = "FAIL";
  state.verifierResults.push({
    criterionId: "tests",
    status: "FAIL",
    verifier: "COMMAND",
    evidenceIds: [],
    details: "test failed",
    deterministic: true,
  });
  const decision = new StopGuard(store).evaluateNaturalStop(state);
  assert.equal(decision.successful, false);
  if (!decision.successful) assert.equal(decision.action, "REPLAN");
});
