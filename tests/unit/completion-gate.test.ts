import assert from "node:assert/strict";
import { test } from "node:test";
import { CompletionCertificateData } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { SessionController } from "../../packages/workflow/src";
import { CompletionGate } from "../../packages/verification/src";
import { buildState, passAll, passCriterion } from "../fixtures/builders";

test("completion gate rejects missing required evidence", () => {
  const state = buildState();
  const store = new EvidenceStore();
  for (const criterion of state.successCriteria) criterion.status = "PASS";
  const decision = new CompletionGate(store).evaluate(state);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.ok(decision.failures.some((failure) => failure.code === "MISSING_ADMISSIBLE_EVIDENCE"));
  }
});

test("completion gate rejects required FAIL", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passAll(state, store);
  const tests = state.successCriteria.find((criterion) => criterion.id === "tests");
  assert.ok(tests);
  tests.status = "FAIL";
  const decision = new CompletionGate(store).evaluate(state);
  assert.equal(decision.allowed, false);
});

test("completion gate rejects required INCONCLUSIVE", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passAll(state, store);
  const tests = state.successCriteria.find((criterion) => criterion.id === "tests");
  assert.ok(tests);
  tests.status = "INCONCLUSIVE";
  const decision = new CompletionGate(store).evaluate(state);
  assert.equal(decision.allowed, false);
});

test("completion gate rejects model-only success claim", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passCriterion(state, store, "failure-reproduced");
  passCriterion(state, store, "tests", { modelOnly: true });
  passCriterion(state, store, "review");
  const decision = new CompletionGate(store).evaluate(state);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.ok(
      decision.failures.some(
        (failure) => failure.code === "MISSING_ADMISSIBLE_EVIDENCE" && failure.criterionId === "tests",
      ),
    );
  }
});

test("deterministic failed verifier overrides reviewer PASS", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passAll(state, store);
  state.verifierResults.push({
    criterionId: "tests",
    status: "FAIL",
    verifier: "COMMAND",
    evidenceIds: [],
    details: "tests still fail",
    deterministic: true,
  });
  state.reviewerVerdict = "PASS";
  const decision = new CompletionGate(store).evaluate(state);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.ok(decision.failures.some((failure) => failure.code === "DETERMINISTIC_FAILURE"));
  }
});

test("application can complete only with a gate-issued certificate", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passAll(state, store);
  const gate = new CompletionGate(store);
  const decision = gate.evaluate(state, "2026-08-25T18:05:00.000Z");
  assert.equal(decision.allowed, true);
  if (!decision.allowed) return;
  const controller = new SessionController(state);
  const completed = controller.completeWithCertificate(decision.certificate);
  assert.equal(completed.phase, "COMPLETED");
  assert.equal(completed.status, "COMPLETED");
});

test("gate-issued certificate is rejected after certified state changes", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passAll(state, store);
  const decision = new CompletionGate(store).evaluate(state, "2026-08-25T18:05:00.000Z");
  assert.equal(decision.allowed, true);
  if (!decision.allowed) return;

  const controller = new SessionController(state);
  controller.setReviewerVerdict("PASS_WITH_WARNINGS");
  assert.throws(
    () => controller.completeWithCertificate(decision.certificate),
    /certificate subject no longer matches session state/,
  );
});

test("changing patch digest invalidates patch-bound verification and review", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passAll(state, store);

  const controller = new SessionController(state);
  const updated = controller.setPatchDigest("a".repeat(64));
  const reproduction = updated.successCriteria.find(
    (criterion) => criterion.id === "failure-reproduced",
  );
  const tests = updated.successCriteria.find((criterion) => criterion.id === "tests");
  const review = updated.successCriteria.find((criterion) => criterion.id === "review");

  assert.equal(reproduction?.status, "PASS");
  assert.deepEqual(reproduction?.evidenceIds, ["evidence-failure-reproduced"]);
  assert.equal(tests?.status, "PENDING");
  assert.deepEqual(tests?.evidenceIds, []);
  assert.equal(review?.status, "PENDING");
  assert.deepEqual(review?.evidenceIds, []);
  assert.deepEqual(
    updated.verifierResults.map((result) => result.criterionId),
    ["failure-reproduced"],
  );
  assert.equal(updated.reviewerVerdict, undefined);
  assert.equal(updated.roundEvaluations.length, 0);
  assert.equal(new CompletionGate(store).evaluate(updated).allowed, false);
});

test("model cannot directly set COMPLETED", () => {
  const controller = new SessionController(buildState());
  assert.throws(() => controller.transition("COMPLETED", "MODEL", "I think it is fixed"));
});

test("fabricated certificate is rejected", () => {
  const state = buildState();
  const controller = new SessionController(state);
  const fabricated: CompletionCertificateData = {
    taskId: state.task.id,
    requiredCriteria: [],
    originalFailureReproduced: true,
    patchDigest: state.patchDigest ?? "",
    reviewerVerdict: "PASS",
    subjectDigest: "0".repeat(64),
    traceId: state.traceId,
    generatedAt: new Date().toISOString(),
  };
  assert.throws(() => controller.completeWithCertificate(fabricated));
});
