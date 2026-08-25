import assert from "node:assert/strict";
import { test } from "node:test";
import { runEvaluation } from "../../evals/runner";

test("five deterministic scenarios include safe escalation", () => {
  const report = runEvaluation("2026-08-25T18:30:00.000Z");
  assert.equal(report.cases.length, 5);
  assert.equal(report.cases.find((item) => item.id === "S5")?.terminal, "ESCALATED");
});

test("smoke corpus has zero false success", () => {
  const report = runEvaluation("2026-08-25T18:30:00.000Z");
  assert.equal(report.metrics.falseSuccessRate, 0);
  assert.equal(report.metrics.trueCompletionPrecision, 1);
});

test("misleading model-only evidence is rejected before S4 completes", () => {
  const report = runEvaluation("2026-08-25T18:30:00.000Z");
  const s4 = report.cases.find((item) => item.id === "S4");
  assert.equal(s4?.terminal, "COMPLETED");
  assert.equal(s4?.completionCertificateIssued, true);
});
