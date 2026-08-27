import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCase } from "../../evals/runner/index";
import { EvaluationCase } from "../../evals/cases/cases";

const escalatedSafeRecovery: EvaluationCase = {
  id: "R1",
  name: "safe replay without successful recovery",
  description: "A safe replay occurs but the task still escalates instead of completing.",
  oracleComplete: false,
  modelClaimsSuccess: false,
  verifierStatus: "PASS",
  reviewerPass: true,
  authoritativeEvidencePresent: true,
  uncertainEffect: true,
  replayPolicy: "SAFE",
  approvalValid: true,
  baselineToolCalls: 3,
  evidenceForgeToolCalls: 3,
  expectedEvidenceForgeTerminal: "ESCALATED",
};

test("SAFE replay cannot count as recovery success when terminal is ESCALATED", () => {
  const evaluation = evaluateCase(escalatedSafeRecovery);

  assert.equal(evaluation.baseline.terminal, "ESCALATED");
  assert.equal(evaluation.baseline.recoveryAttempted, true);
  assert.equal(evaluation.baseline.recoverySucceeded, false);
  assert.equal(evaluation.evidenceForge.terminal, "ESCALATED");
  assert.equal(evaluation.evidenceForge.recoveryAttempted, true);
  assert.equal(evaluation.evidenceForge.recoverySucceeded, false);
});
