import assert from "node:assert/strict";
import { test } from "node:test";
import { runEvaluation } from "../../evals/runner";

test("comparison corpus covers fixture and adversarial control paths", () => {
  const report = runEvaluation("2026-08-25T18:30:00.000Z");
  assert.equal(report.cases.length, 15);
  assert.equal(report.cases.find((item) => item.id === "S5")?.evidenceForge.terminal, "ESCALATED");
  assert.equal(report.cases.find((item) => item.id === "A6")?.evidenceForge.terminal, "BLOCKED");
  assert.equal(report.cases.find((item) => item.id === "A9")?.evidenceForge.terminal, "BLOCKED");
});

test("EvidenceForge removes baseline false success on the deterministic corpus", () => {
  const report = runEvaluation("2026-08-25T18:30:00.000Z");
  assert.ok(report.metrics.baseline.falseSuccessRate > 0);
  assert.equal(report.metrics.evidenceForge.falseSuccessRate, 0);
  assert.equal(report.metrics.evidenceForge.trueCompletionPrecision, 1);
});

test("completion and recovery require certificates and policy-correct settlement", () => {
  const report = runEvaluation("2026-08-25T18:30:00.000Z");
  const s4 = report.cases.find((item) => item.id === "S4");
  const safeRead = report.cases.find((item) => item.id === "A7");
  const reconciledWrite = report.cases.find((item) => item.id === "A8");
  assert.equal(s4?.evidenceForge.completionCertificateIssued, true);
  assert.equal(safeRead?.evidenceForge.recoverySucceeded, true);
  assert.equal(reconciledWrite?.evidenceForge.recoverySucceeded, true);
});
