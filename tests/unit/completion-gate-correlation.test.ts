import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingCriterion } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { CompletionGate } from "../../packages/verification/src";
import { baseCriteria, buildState, passAll } from "../fixtures/builders";

test("completion gate rejects PASS criteria without a verifier result", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passAll(state, store);
  state.verifierResults = state.verifierResults.filter(
    (result) => result.criterionId !== "tests",
  );

  const decision = new CompletionGate(store).evaluate(state);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.ok(
      decision.failures.some(
        (failure) =>
          failure.criterionId === "tests" &&
          failure.code === "MISSING_ADMISSIBLE_EVIDENCE" &&
          /verifier result/.test(failure.message),
      ),
    );
  }
});

test("a later deterministic PASS supersedes an earlier failed attempt", () => {
  const state = buildState();
  const store = new EvidenceStore();
  state.verifierResults.push({
    criterionId: "tests",
    status: "FAIL",
    verifier: "COMMAND",
    evidenceIds: [],
    details: "first patch attempt still failed",
    deterministic: true,
  });
  passAll(state, store);

  const decision = new CompletionGate(store).evaluate(state);
  assert.equal(decision.allowed, true);
});

test("latest PASS result must reference admissible criterion evidence", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passAll(state, store);
  const testsResult = state.verifierResults.find((result) => result.criterionId === "tests");
  assert.ok(testsResult);
  testsResult.evidenceIds = ["evidence-review"];

  const decision = new CompletionGate(store).evaluate(state);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.ok(
      decision.failures.some(
        (failure) =>
          failure.criterionId === "tests" &&
          failure.code === "MISSING_ADMISSIBLE_EVIDENCE",
      ),
    );
  }
});

test("required external-state criterion needs a reconciled external action", () => {
  const externalCriterion = pendingCriterion("external-pr", "Pull request reconciled", {
    kind: "EXTERNAL_STATE",
    actionType: "pull_request",
    expectedHeadSha: "94cc31d",
  });
  const state = buildState([...baseCriteria(), externalCriterion]);
  const store = new EvidenceStore();
  passAll(state, store);

  const decision = new CompletionGate(store).evaluate(state);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.ok(
      decision.failures.some(
        (failure) => failure.code === "EXTERNAL_ACTION_NOT_RECONCILED",
      ),
    );
  }
});
