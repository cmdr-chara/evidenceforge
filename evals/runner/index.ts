import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EvidenceStore } from "../../packages/evidence/src";
import {
  artifactBindingFor,
  CompletionGate,
  ProgressEvaluator,
} from "../../packages/verification/src";
import { SessionController } from "../../packages/workflow/src";
import { buildState, passAll } from "../../tests/fixtures/builders";
import { EVALUATION_CASES, EvaluationCase } from "../cases/cases";

export type EvaluationTerminal = "COMPLETED" | "BLOCKED" | "ESCALATED";

export interface SystemScenarioEvaluation {
  terminal: EvaluationTerminal;
  falseSuccess: boolean;
  completionCertificateIssued: boolean;
  verificationExecuted: boolean;
  verificationCoverage: number;
  recoveryAttempted: boolean;
  recoverySucceeded: boolean;
  repeatedNoProgressToolAttempts: number;
  retryCount: number;
  replanCount: number;
  unnecessaryActions: number;
  humanInterventions: number;
  toolCallCount: number;
  controlEvaluationLatencyMs: number;
}

export interface ComparisonScenarioEvaluation {
  id: string;
  name: string;
  oracleComplete: boolean;
  baseline: SystemScenarioEvaluation;
  evidenceForge: SystemScenarioEvaluation;
}

export interface AggregateMetrics {
  falseSuccessRate: number;
  trueCompletionPrecision: number;
  taskCompletionRate: number;
  resolvableTaskCompletionRate: number;
  verificationCoverage: number;
  recoverySuccessRate: number;
  repeatedNoProgressToolAttempts: number;
  retryCount: number;
  replanCount: number;
  unnecessaryActions: number;
  humanInterventions: number;
  toolCallCount: number;
  controlEvaluationLatencyMs: number;
}

export interface EvaluationReport {
  generatedAt: string;
  methodology: {
    baseline: string;
    candidate: string;
    corpus: string;
    latencyScope: string;
  };
  cases: ComparisonScenarioEvaluation[];
  metrics: { baseline: AggregateMetrics; evidenceForge: AggregateMetrics };
}

export function evaluateCase(testCase: EvaluationCase): ComparisonScenarioEvaluation {
  return {
    id: testCase.id,
    name: testCase.name,
    oracleComplete: testCase.oracleComplete,
    baseline: evaluateBaseline(testCase),
    evidenceForge: evaluateEvidenceForge(testCase),
  };
}

export function runEvaluation(generatedAt = new Date().toISOString()): EvaluationReport {
  const cases = EVALUATION_CASES.map(evaluateCase);
  return {
    generatedAt,
    methodology: {
      baseline: "same deterministic scenario inputs; model/reviewer success may terminate without CompletionGate",
      candidate: "same inputs plus EvidenceForge deterministic verification, replay, approval, loop, and completion policy",
      corpus: "fixture control-policy simulation; no live model, GitHub MCP, Daytona, or network claims",
      latencyScope: "measured local JavaScript control-decision time only; excludes tools, model, sandbox, and network",
    },
    cases,
    metrics: {
      baseline: aggregate(cases.map((item) => item.baseline), cases),
      evidenceForge: aggregate(cases.map((item) => item.evidenceForge), cases),
    },
  };
}

function evaluateBaseline(testCase: EvaluationCase): SystemScenarioEvaluation {
  const started = performance.now();
  const terminal: EvaluationTerminal = testCase.modelClaimsSuccess ? "COMPLETED" : "ESCALATED";
  return finish(started, testCase, terminal, {
    completionCertificateIssued: false,
    verificationExecuted: testCase.verifierStatus !== "NOT_RUN",
    verificationCoverage: testCase.verifierStatus === "NOT_RUN" ? 0 : 1,
    recoveryAttempted: testCase.uncertainEffect === true,
    recoverySucceeded: didRecoverySucceed(testCase, terminal),
    repeatedNoProgressToolAttempts: Math.max(0, (testCase.repeatedEquivalentAttempts ?? 1) - 1),
    retryCount: testCase.baselineRetries ?? 0,
    replanCount: 0,
    unnecessaryActions: testCase.baselineUnnecessaryActions ?? 0,
    humanInterventions: 0,
    toolCallCount: testCase.baselineToolCalls,
  });
}

function evaluateEvidenceForge(testCase: EvaluationCase): SystemScenarioEvaluation {
  const started = performance.now();
  const terminal = determineEvidenceForgeTerminal(testCase);
  if (terminal !== testCase.expectedEvidenceForgeTerminal) {
    throw new Error(
      `${testCase.id} reached ${terminal}, expected ${testCase.expectedEvidenceForgeTerminal}`,
    );
  }
  let certificateIssued = false;
  if (terminal === "COMPLETED") {
    const state = buildState();
    state.task.id = `eval-${testCase.id}`;
    state.reviewBinding = artifactBindingFor(state, "PATCH");
    const store = new EvidenceStore();
    passAll(state, store);
    new ProgressEvaluator(store).evaluate(state, "VERIFICATION");
    const decision = new CompletionGate(store).evaluate(state);
    if (!decision.allowed) throw new Error(`${testCase.id} could not issue its expected certificate`);
    new SessionController(state).completeWithCertificate(decision.certificate);
    certificateIssued = true;
  }
  const recoveryAttempted = testCase.uncertainEffect === true;
  return finish(started, testCase, terminal, {
    completionCertificateIssued: certificateIssued,
    verificationExecuted: testCase.verifierStatus !== "NOT_RUN",
    verificationCoverage: testCase.verifierStatus === "NOT_RUN" ? 0 : 1,
    recoveryAttempted,
    recoverySucceeded: didRecoverySucceed(testCase, terminal),
    repeatedNoProgressToolAttempts:
      testCase.repeatedEquivalentAttempts === undefined
        ? 0
        : Math.min(3, Math.max(0, testCase.repeatedEquivalentAttempts - 1)),
    retryCount: testCase.evidenceForgeRetries ?? 0,
    replanCount: testCase.evidenceForgeReplans ?? 0,
    unnecessaryActions: testCase.evidenceForgeUnnecessaryActions ?? 0,
    humanInterventions:
      terminal === "BLOCKED" || (terminal === "ESCALATED" && !testCase.oracleComplete) ? 1 : 0,
    toolCallCount: testCase.evidenceForgeToolCalls,
  });
}

function didRecoverySucceed(
  testCase: EvaluationCase,
  terminal: EvaluationTerminal,
): boolean {
  if (testCase.uncertainEffect !== true || terminal !== "COMPLETED") return false;
  if (testCase.replayPolicy === "SAFE") return true;
  return (
    testCase.replayPolicy === "RECONCILE_FIRST" &&
    testCase.reconciliationResult === "SUCCEEDED"
  );
}

function determineEvidenceForgeTerminal(testCase: EvaluationCase): EvaluationTerminal {
  if (testCase.approvalValid === false) return "BLOCKED";
  if (testCase.uncertainEffect) {
    if (testCase.replayPolicy === "NEVER") return "BLOCKED";
    if (
      testCase.replayPolicy === "RECONCILE_FIRST" &&
      testCase.reconciliationResult !== "SUCCEEDED"
    ) {
      return testCase.reconciliationResult === "UNAVAILABLE" ? "BLOCKED" : "ESCALATED";
    }
  }
  if ((testCase.repeatedEquivalentAttempts ?? 0) >= 4) return "ESCALATED";
  if (
    testCase.verifierStatus !== "PASS" ||
    !testCase.reviewerPass ||
    !testCase.authoritativeEvidencePresent
  ) {
    return "ESCALATED";
  }
  return testCase.oracleComplete ? "COMPLETED" : "ESCALATED";
}

function finish(
  started: number,
  testCase: EvaluationCase,
  terminal: EvaluationTerminal,
  fields: Omit<SystemScenarioEvaluation, "terminal" | "falseSuccess" | "controlEvaluationLatencyMs">,
): SystemScenarioEvaluation {
  return {
    terminal,
    falseSuccess: terminal === "COMPLETED" && !testCase.oracleComplete,
    ...fields,
    controlEvaluationLatencyMs: performance.now() - started,
  };
}

function aggregate(
  results: SystemScenarioEvaluation[],
  cases: ComparisonScenarioEvaluation[],
): AggregateMetrics {
  const completedIndexes = results.flatMap((result, index) =>
    result.terminal === "COMPLETED" ? [index] : [],
  );
  const trueCompleted = completedIndexes.filter((index) => cases[index]?.oracleComplete === true);
  const recoverable = results.filter((result) => result.recoveryAttempted);
  return {
    falseSuccessRate:
      completedIndexes.length === 0
        ? 0
        : completedIndexes.filter((index) => results[index]?.falseSuccess).length /
          completedIndexes.length,
    trueCompletionPrecision:
      completedIndexes.length === 0 ? 0 : trueCompleted.length / completedIndexes.length,
    taskCompletionRate: completedIndexes.length / results.length,
    resolvableTaskCompletionRate:
      cases.filter((item) => item.oracleComplete).length === 0
        ? 0
        : trueCompleted.length / cases.filter((item) => item.oracleComplete).length,
    verificationCoverage: average(results.map((result) => result.verificationCoverage)),
    recoverySuccessRate:
      recoverable.length === 0
        ? 0
        : recoverable.filter((result) => result.recoverySucceeded).length / recoverable.length,
    repeatedNoProgressToolAttempts: sum(results.map((result) => result.repeatedNoProgressToolAttempts)),
    retryCount: sum(results.map((result) => result.retryCount)),
    replanCount: sum(results.map((result) => result.replanCount)),
    unnecessaryActions: sum(results.map((result) => result.unnecessaryActions)),
    humanInterventions: sum(results.map((result) => result.humanInterventions)),
    toolCallCount: sum(results.map((result) => result.toolCallCount)),
    controlEvaluationLatencyMs: sum(results.map((result) => result.controlEvaluationLatencyMs)),
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

if (require.main === module) {
  const report = runEvaluation();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (process.argv.includes("--write-report")) {
    const reportDirectory = resolve(process.cwd(), "evals", "reports");
    mkdirSync(reportDirectory, { recursive: true });
    const date = report.generatedAt.slice(0, 10);
    writeFileSync(join(reportDirectory, `${date}-comparison.json`), serialized);
    writeFileSync(join(reportDirectory, "latest-comparison.json"), serialized);
  }
  process.stdout.write(serialized);
}
