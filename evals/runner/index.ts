import { createHash } from "node:crypto";
import { CompletionGate } from "../../packages/verification/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { SessionController } from "../../packages/workflow/src";
import { buildState, passAll, passCriterion } from "../../tests/fixtures/builders";
import { EVALUATION_CASES, EvaluationCase } from "../cases/cases";

export interface ScenarioEvaluation {
  id: string;
  name: string;
  terminal: "COMPLETED" | "ESCALATED";
  oracleComplete: boolean;
  falseSuccess: boolean;
  requiredCriteriaPassed: number;
  requiredCriteriaTotal: number;
  completionCertificateIssued: boolean;
  failureReproduced: boolean;
}

export interface EvaluationReport {
  generatedAt: string;
  cases: ScenarioEvaluation[];
  metrics: {
    falseSuccessRate: number;
    trueCompletionPrecision: number;
    taskSuccessRate: number;
    reproductionRate: number;
    verificationCoverage: number;
    escalationRate: number;
  };
}

export function evaluateCase(testCase: EvaluationCase): ScenarioEvaluation {
  const state = buildState();
  state.task.id = `eval-${testCase.id}`;
  state.traceId = `trace-${testCase.id}`;
  state.patchDigest = createHash("sha256").update(`patch-${testCase.id}`).digest("hex");
  const store = new EvidenceStore();
  let terminal: "COMPLETED" | "ESCALATED";
  let certificateIssued = false;

  if (testCase.oracleComplete) {
    if (testCase.misleadingModelClaim) {
      passCriterion(state, store, "failure-reproduced");
      passCriterion(state, store, "tests", { modelOnly: true });
      passCriterion(state, store, "review");
      const premature = new CompletionGate(store).evaluate(state);
      if (premature.allowed) throw new Error(`${testCase.id} accepted model-only evidence`);
      const tests = state.successCriteria.find((criterion) => criterion.id === "tests");
      if (tests === undefined) throw new Error("tests criterion missing");
      tests.status = "PENDING";
      tests.evidenceIds = [];
      state.verifierResults = state.verifierResults.filter((result) => result.criterionId !== "tests");
      state.evidenceIds = state.evidenceIds.filter((id) => id !== "evidence-tests");
      const cleanStore = new EvidenceStore();
      passAll(state, cleanStore);
      const decision = new CompletionGate(cleanStore).evaluate(state);
      if (!decision.allowed) throw new Error(`${testCase.id} should complete after deterministic evidence`);
      new SessionController(state).completeWithCertificate(decision.certificate);
      certificateIssued = true;
    } else {
      passAll(state, store);
      const decision = new CompletionGate(store).evaluate(state);
      if (!decision.allowed) throw new Error(`${testCase.id} should complete`);
      new SessionController(state).completeWithCertificate(decision.certificate);
      certificateIssued = true;
    }
    terminal = "COMPLETED";
  } else {
    const controller = new SessionController(state);
    controller.transition("DEFINE_SUCCESS", "APPLICATION", "intake complete");
    controller.transition("PLANNING", "APPLICATION", "contract defined");
    controller.transition("INVESTIGATING", "APPLICATION", "plan ready");
    controller.transition("ESCALATED", "APPLICATION", "insufficient evidence after bounded replans");
    terminal = "ESCALATED";
  }

  const passed = state.successCriteria.filter((criterion) => criterion.required && criterion.status === "PASS").length;
  const total = state.successCriteria.filter((criterion) => criterion.required).length;
  return {
    id: testCase.id,
    name: testCase.name,
    terminal,
    oracleComplete: testCase.oracleComplete,
    falseSuccess: terminal === "COMPLETED" && !testCase.oracleComplete,
    requiredCriteriaPassed: passed,
    requiredCriteriaTotal: total,
    completionCertificateIssued: certificateIssued,
    failureReproduced: state.successCriteria.find((criterion) => criterion.id === "failure-reproduced")?.status === "PASS",
  };
}

export function runEvaluation(generatedAt = new Date().toISOString()): EvaluationReport {
  const cases = EVALUATION_CASES.map(evaluateCase);
  const completed = cases.filter((item) => item.terminal === "COMPLETED");
  const trueCompleted = completed.filter((item) => item.oracleComplete);
  const falseSuccesses = completed.filter((item) => item.falseSuccess);
  const resolvable = cases.filter((item) => item.oracleComplete);
  const reproduced = cases.filter((item) => item.failureReproduced);
  const totalRequired = cases.reduce((sum, item) => sum + item.requiredCriteriaTotal, 0);
  const passedRequired = cases.reduce((sum, item) => sum + item.requiredCriteriaPassed, 0);
  return {
    generatedAt,
    cases,
    metrics: {
      falseSuccessRate: completed.length === 0 ? 0 : falseSuccesses.length / completed.length,
      trueCompletionPrecision: completed.length === 0 ? 0 : trueCompleted.length / completed.length,
      taskSuccessRate: resolvable.length === 0 ? 0 : trueCompleted.length / resolvable.length,
      reproductionRate: cases.length === 0 ? 0 : reproduced.length / cases.length,
      verificationCoverage: totalRequired === 0 ? 0 : passedRequired / totalRequired,
      escalationRate: cases.filter((item) => item.terminal === "ESCALATED").length / cases.length,
    },
  };
}

if (require.main === module) {
  const report = runEvaluation();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
