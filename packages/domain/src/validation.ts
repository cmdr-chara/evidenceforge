import {
  CriterionStatus,
  RISK_LEVELS,
  SessionState,
  SuccessCriterion,
  Task,
  WORKFLOW_PHASES,
} from "./types";

export class DomainValidationError extends Error {
  public readonly issues: string[];

  public constructor(issues: string[]) {
    super(`Domain validation failed: ${issues.join("; ")}`);
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

const CRITERION_STATUSES: CriterionStatus[] = ["PENDING", "PASS", "FAIL", "INCONCLUSIVE"];

export function assertNonEmpty(value: string, field: string, issues: string[]): void {
  if (value.trim().length === 0) issues.push(`${field} must be non-empty`);
}

export function assertIsoTimestamp(value: string, field: string, issues: string[]): void {
  if (Number.isNaN(Date.parse(value))) issues.push(`${field} must be an ISO timestamp`);
}

export function validateTask(task: Task): Task {
  const issues: string[] = [];
  assertNonEmpty(task.id, "task.id", issues);
  assertNonEmpty(task.objective, "task.objective", issues);
  assertNonEmpty(task.repository, "task.repository", issues);
  assertNonEmpty(task.revision, "task.revision", issues);
  assertIsoTimestamp(task.createdAt, "task.createdAt", issues);
  if (task.source.kind !== "GITHUB_ACTIONS") issues.push("task.source.kind is unsupported");
  assertNonEmpty(task.source.runId, "task.source.runId", issues);
  if (issues.length > 0) throw new DomainValidationError(issues);
  return task;
}

export function validateSuccessCriterion(criterion: SuccessCriterion): SuccessCriterion {
  const issues: string[] = [];
  assertNonEmpty(criterion.id, "criterion.id", issues);
  assertNonEmpty(criterion.description, "criterion.description", issues);
  if (!CRITERION_STATUSES.includes(criterion.status)) issues.push("criterion.status is invalid");
  if (criterion.verifier.kind === "COMMAND" || criterion.verifier.kind === "FAILURE_SIGNATURE") {
    if (criterion.verifier.argv.length === 0) issues.push("command verifier argv cannot be empty");
    if (criterion.verifier.timeoutSeconds <= 0) issues.push("command verifier timeout must be positive");
  }
  if (issues.length > 0) throw new DomainValidationError(issues);
  return criterion;
}

export function validateSessionState(state: SessionState): SessionState {
  const issues: string[] = [];
  validateTask(state.task);
  if (!WORKFLOW_PHASES.includes(state.phase)) issues.push("session.phase is invalid");
  if (state.version < 1) issues.push("session.version must be >= 1");
  if (state.plan.version < 1) issues.push("plan.version must be >= 1");
  if (state.patchAttempts < 0 || state.replanAttempts < 0 || state.transientAttempts < 0) {
    issues.push("attempt counters cannot be negative");
  }
  const criterionIds = new Set<string>();
  for (const criterion of state.successCriteria) {
    validateSuccessCriterion(criterion);
    if (criterionIds.has(criterion.id)) issues.push(`duplicate criterion id: ${criterion.id}`);
    criterionIds.add(criterion.id);
  }
  const planIds = new Set(state.plan.steps.map((step) => step.id));
  for (const step of state.plan.steps) {
    if (!RISK_LEVELS.includes(step.riskCeiling)) issues.push(`invalid risk ceiling on ${step.id}`);
    for (const dependency of step.dependencies) {
      if (!planIds.has(dependency)) issues.push(`unknown dependency ${dependency} on ${step.id}`);
    }
  }
  if (state.phase === "COMPLETED" && state.status !== "COMPLETED") {
    issues.push("COMPLETED phase requires COMPLETED status");
  }
  if (state.status === "COMPLETED" && state.completionCertificate === undefined) {
    issues.push("COMPLETED status requires a completion certificate");
  }
  if (issues.length > 0) throw new DomainValidationError(issues);
  return state;
}
