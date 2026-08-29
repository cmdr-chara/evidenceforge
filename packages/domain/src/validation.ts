import {
  CriterionStatus,
  EVIDENCE_SCOPES,
  PullRequestIdentity,
  REPLAY_POLICIES,
  RISK_LEVELS,
  SessionState,
  SuccessCriterion,
  Task,
  WORKFLOW_PHASES,
} from "./types";
import { digestCanonical } from "./canonical";

export class DomainValidationError extends Error {
  public readonly issues: string[];

  public constructor(issues: string[]) {
    super(`Domain validation failed: ${issues.join("; ")}`);
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

const CRITERION_STATUSES: CriterionStatus[] = ["PENDING", "PASS", "FAIL", "INCONCLUSIVE"];
const SESSION_STATUSES = ["ACTIVE", "COMPLETED", "BLOCKED", "ESCALATED", "FAILED"] as const;
const APPROVAL_STATUSES = ["PENDING", "APPROVED", "DENIED"] as const;
const TERMINAL_PHASE_STATUS = {
  COMPLETED: "COMPLETED",
  BLOCKED: "BLOCKED",
  ESCALATED: "ESCALATED",
  FAILED: "FAILED",
} as const;

export const TASK_OBJECTIVE_MAX_LENGTH = 4_096;
export const TASK_REPOSITORY_MAX_LENGTH = 256;
export const TASK_REVISION_MAX_LENGTH = 128;
export const TASK_RUN_ID_MAX_LENGTH = 128;
export const TASK_CONSTRAINT_MAX_COUNT = 16;
export const TASK_CONSTRAINT_MAX_LENGTH = 1_024;
export const TASK_PROMPT_TEXT_MAX_LENGTH = 8_192;

export function assertNonEmpty(value: string, field: string, issues: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${field} must be non-empty`);
  }
}

function assertMaxLength(
  value: unknown,
  maximum: number,
  field: string,
  issues: string[],
): void {
  if (typeof value === "string" && value.length > maximum) {
    issues.push(`${field} must be at most ${maximum} characters`);
  }
}

function jsonSerializedLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized.length : 0;
}

export function assertIsoTimestamp(value: string, field: string, issues: string[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    issues.push(`${field} must be an ISO timestamp`);
  }
}

export function validateTask(task: Task): Task {
  const issues: string[] = [];
  assertNonEmpty(task.id, "task.id", issues);
  assertNonEmpty(task.objective, "task.objective", issues);
  assertNonEmpty(task.repository, "task.repository", issues);
  assertNonEmpty(task.revision, "task.revision", issues);
  assertMaxLength(task.objective, TASK_OBJECTIVE_MAX_LENGTH, "task.objective", issues);
  assertMaxLength(task.repository, TASK_REPOSITORY_MAX_LENGTH, "task.repository", issues);
  assertMaxLength(task.revision, TASK_REVISION_MAX_LENGTH, "task.revision", issues);
  assertIsoTimestamp(task.createdAt, "task.createdAt", issues);
  if (task.source.kind !== "GITHUB_ACTIONS") issues.push("task.source.kind is unsupported");
  assertNonEmpty(task.source.runId, "task.source.runId", issues);
  assertMaxLength(task.source.runId, TASK_RUN_ID_MAX_LENGTH, "task.source.runId", issues);
  if (!Array.isArray(task.constraints)) {
    issues.push("task.constraints must be an array");
  } else {
    if (task.constraints.length > TASK_CONSTRAINT_MAX_COUNT) {
      issues.push(`task.constraints must contain at most ${TASK_CONSTRAINT_MAX_COUNT} items`);
    }
    for (const [index, constraint] of task.constraints.entries()) {
      assertNonEmpty(constraint, `task.constraints[${index}]`, issues);
      assertMaxLength(
        constraint,
        TASK_CONSTRAINT_MAX_LENGTH,
        `task.constraints[${index}]`,
        issues,
      );
    }
  }
  const promptTextLength =
    jsonSerializedLength(task.objective) +
    (typeof task.repository === "string" ? task.repository.length : 0) +
    (typeof task.revision === "string" ? task.revision.length : 0) +
    (typeof task.source.runId === "string" ? task.source.runId.length : 0) +
    jsonSerializedLength(Array.isArray(task.constraints) ? task.constraints : []);
  if (promptTextLength > TASK_PROMPT_TEXT_MAX_LENGTH) {
    issues.push(
      `task prompt text must be at most ${TASK_PROMPT_TEXT_MAX_LENGTH} characters in aggregate`,
    );
  }
  if (issues.length > 0) throw new DomainValidationError(issues);
  return task;
}

export function validateSuccessCriterion(criterion: SuccessCriterion): SuccessCriterion {
  const issues: string[] = [];
  assertNonEmpty(criterion.id, "criterion.id", issues);
  assertNonEmpty(criterion.description, "criterion.description", issues);
  if (!CRITERION_STATUSES.includes(criterion.status)) issues.push("criterion.status is invalid");
  if (!EVIDENCE_SCOPES.includes(criterion.evidenceScope)) {
    issues.push("criterion.evidenceScope is invalid");
  }
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
  if (state.livePullRequestHead !== undefined) {
    const head = state.livePullRequestHead;
    if (
      head.length === 0 ||
      head.length > 200 ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(head) ||
      head.endsWith(".") ||
      head.endsWith("/") ||
      head.includes("..") ||
      head.includes("//") ||
      head.includes("@{") ||
      head.split("/").some((segment) => segment.endsWith(".lock"))
    ) {
      issues.push("session.livePullRequestHead must be a safe Git branch name");
    }
  }
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
  const operationIds = new Set<string>();
  for (const operation of state.operations) {
    if (operationIds.has(operation.id)) issues.push(`duplicate operation id: ${operation.id}`);
    operationIds.add(operation.id);
    if (!REPLAY_POLICIES.includes(operation.replayPolicy)) {
      issues.push(`invalid replay policy on ${operation.id}`);
    }
    if (operation.status === "SETTLED" && operation.settlement === undefined) {
      issues.push(`settled operation ${operation.id} is missing settlement`);
    }
    if (operation.status !== "SETTLED" && operation.settlement !== undefined) {
      issues.push(`unsettled operation ${operation.id} has settlement data`);
    }
  }
  if (state.phase === "COMPLETED" && state.status !== "COMPLETED") {
    issues.push("COMPLETED phase requires COMPLETED status");
  }
  if (state.status === "COMPLETED" && state.completionCertificate === undefined) {
    issues.push("COMPLETED status requires a completion certificate");
  }
  if (!SESSION_STATUSES.includes(state.status)) issues.push("session.status is invalid");
  for (const approval of state.approvals) {
    if (!APPROVAL_STATUSES.includes(approval.status)) {
      issues.push(`invalid approval status on ${approval.id}`);
    }
    const provenance = approval.provenance;
    if (provenance === undefined) continue;
    assertIsoTimestamp(provenance.issuedAt, `approval ${approval.id}.provenance.issuedAt`, issues);
    assertIsoTimestamp(provenance.expiresAt, `approval ${approval.id}.provenance.expiresAt`, issues);
    const issuedAt = timestampMillis(provenance.issuedAt);
    const expiresAt = timestampMillis(provenance.expiresAt);
    if (
      Number.isFinite(issuedAt) &&
      Number.isFinite(expiresAt) &&
      expiresAt <= issuedAt
    ) {
      issues.push(`approval ${approval.id}.provenance.expiresAt must be after issuedAt`);
    }
    if (provenance.consumedAt !== undefined) {
      assertIsoTimestamp(provenance.consumedAt, `approval ${approval.id}.provenance.consumedAt`, issues);
    }
  }
  if (state.status !== "COMPLETED" && state.phase === "COMPLETED") {
    issues.push("non-COMPLETED status cannot use COMPLETED phase");
  }
  const terminalStatus = TERMINAL_PHASE_STATUS[state.phase as keyof typeof TERMINAL_PHASE_STATUS];
  if (terminalStatus !== undefined && state.status !== terminalStatus) {
    issues.push(`${state.phase} phase requires ${terminalStatus} status`);
  }
  const terminalPhase = Object.entries(TERMINAL_PHASE_STATUS).find(
    ([, status]) => status === state.status,
  )?.[0];
  if (terminalPhase !== undefined && state.phase !== terminalPhase) {
    issues.push(`${state.status} status requires ${terminalPhase} phase`);
  }
  if (state.status !== "COMPLETED" && state.completionCertificate !== undefined) {
    issues.push("only COMPLETED status may contain a completion certificate");
  }
  if (state.status === "COMPLETED" && state.completionCertificate !== undefined) {
    validateCompletionCertificate(state, issues);
  }
  if (issues.length > 0) throw new DomainValidationError(issues);
  return state;
}

function validateCompletionCertificate(
  state: SessionState,
  issues: string[],
): void {
  const certificate = state.completionCertificate;
  if (certificate === undefined) return;
  const prefix = "completion certificate";
  if (certificate.certificateVersion !== 2) {
    issues.push(`${prefix}.certificateVersion is unsupported`);
  }
  if (certificate.taskId !== state.task.id) issues.push(`${prefix}.taskId does not match session`);
  if (certificate.repository !== state.task.repository) {
    issues.push(`${prefix}.repository does not match session`);
  }
  if (certificate.revision !== state.task.revision) {
    issues.push(`${prefix}.revision does not match session`);
  }
  if (
    typeof certificate.patchDigest !== "string" ||
    certificate.patchDigest !== state.patchDigest ||
    certificate.patchDigest.trim().length === 0
  ) {
    issues.push(`${prefix}.patchDigest does not match session`);
  }
  if (certificate.traceId !== state.traceId) issues.push(`${prefix}.traceId does not match session`);
  if (certificate.stateVersion !== state.version - 1 || certificate.stateVersion < 1) {
    issues.push(`${prefix}.stateVersion does not identify the pre-completion state`);
  }
  if (!isPreCompletionPhase(certificate.preCompletionPhase)) {
    issues.push(`${prefix}.preCompletionPhase must be an ACTIVE non-terminal phase`);
  }
  if (certificate.successContractDigest !== successContractDigestFor(state)) {
    issues.push(`${prefix}.successContractDigest does not match session`);
  }
  if (certificate.reviewerVerdict !== state.reviewerVerdict) {
    issues.push(`${prefix}.reviewerVerdict does not match session`);
  }
  if (certificate.originalFailureReproduced !== true) {
    issues.push(`${prefix}.originalFailureReproduced must be true`);
  }
  assertIsoTimestamp(certificate.generatedAt, `${prefix}.generatedAt`, issues);

  const required = state.successCriteria.filter((criterion) => criterion.required);
  const certificateCriteria = Array.isArray(certificate.requiredCriteria)
    ? certificate.requiredCriteria
    : [];
  if (!Array.isArray(certificate.requiredCriteria)) {
    issues.push(`${prefix}.requiredCriteria is malformed`);
  }
  if (certificateCriteria.length !== required.length) {
    issues.push(`${prefix}.requiredCriteria does not match required session criteria`);
  }
  const seenCriteria = new Set<string>();
  for (let index = 0; index < certificateCriteria.length; index += 1) {
    const entry = certificateCriteria[index];
    if (entry === undefined || !isRecord(entry)) {
      issues.push(`${prefix}.requiredCriteria[${index}] is malformed`);
      continue;
    }
    const criterionId = entry.criterionId;
    const criterion = required[index];
    if (typeof criterionId !== "string" || criterion === undefined || criterionId !== criterion.id) {
      issues.push(`${prefix}.requiredCriteria[${index}] is not in required order`);
    }
    if (typeof criterionId === "string" && seenCriteria.has(criterionId)) {
      issues.push(`${prefix}.requiredCriteria contains duplicate ${criterionId}`);
    }
    if (typeof criterionId === "string") seenCriteria.add(criterionId);
    if (entry.result !== "PASS") issues.push(`${prefix}.requiredCriteria[${index}] is not PASS`);
    if (!Array.isArray(entry.evidenceIds) || entry.evidenceIds.length === 0) {
      issues.push(`${prefix}.requiredCriteria[${index}] has no evidence`);
      continue;
    }
    const evidenceIds = entry.evidenceIds;
    const seenEvidence = new Set<string>();
    for (const evidenceId of evidenceIds) {
      if (typeof evidenceId !== "string") {
        issues.push(`${prefix}.requiredCriteria[${index}] contains a malformed evidence ID`);
        continue;
      }
      if (seenEvidence.has(evidenceId)) {
        issues.push(`${prefix}.requiredCriteria[${index}] contains duplicate evidence ${evidenceId}`);
      }
      seenEvidence.add(evidenceId);
      if (criterion !== undefined && !criterion.evidenceIds.includes(evidenceId)) {
        issues.push(`${prefix}.requiredCriteria[${index}] references unlinked evidence ${evidenceId}`);
      }
    }
  }
  for (const criterion of required) {
    if (criterion.status !== "PASS") {
      issues.push(`${prefix} requires required criterion ${criterion.id} to be PASS`);
    }
  }

  const expectedExternalAction =
    state.externalAction?.status === "RECONCILED"
      ? {
          type: "pull_request" as const,
          ...state.externalAction.reconciledIdentity,
          evidenceId: state.externalAction.evidenceId,
        }
      : undefined;
  if (
    state.externalAction?.status === "RECONCILED" &&
    (typeof state.externalAction.identifier !== "string" ||
      state.externalAction.identifier.trim().length === 0 ||
      typeof state.externalAction.evidenceId !== "string" ||
      state.externalAction.evidenceId.trim().length === 0 ||
      !isPullRequestIdentity(state.externalAction.reconciledIdentity))
  ) {
    issues.push(`${prefix} requires a complete reconciled external action`);
  }
  if (
    state.externalAction !== undefined &&
    state.externalAction.status !== "RECONCILED"
  ) {
    issues.push(`${prefix} cannot certify an unreconciled external action`);
  }
  if (
    digestCanonical(certificate.externalAction ?? null) !==
    digestCanonical(expectedExternalAction ?? null)
  ) {
    issues.push(`${prefix}.externalAction does not match session`);
  }
  if (
    certificate.externalAction !== undefined &&
    (certificate.externalAction.type !== "pull_request" ||
      typeof certificate.externalAction.evidenceId !== "string" ||
      certificate.externalAction.evidenceId.trim().length === 0 ||
      !isPullRequestIdentity(certificate.externalAction))
  ) {
    issues.push(`${prefix}.externalAction is malformed`);
  }

  const expectedSubjectDigest = digestCanonical({
    taskId: certificate.taskId,
    repository: certificate.repository,
    revision: certificate.revision,
    patchDigest: certificate.patchDigest,
    stateVersion: certificate.stateVersion,
    preCompletionPhase: certificate.preCompletionPhase,
    successContractDigest: certificate.successContractDigest,
    stateDigest: certificate.stateDigest,
  });
  if (certificate.subjectDigest !== expectedSubjectDigest) {
    issues.push(`${prefix}.subjectDigest is invalid`);
  }
  // `CompletionGate` includes the optional externalAction property in its
  // object literal even when it is undefined. JSON persistence omits that
  // property, so put the same canonical null back before checking the digest.
  const payload = { ...certificate, externalAction: certificate.externalAction };
  const { payloadDigest: _payloadDigest, ...unsignedPayload } = payload;
  if (certificate.payloadDigest !== digestCanonical(unsignedPayload)) {
    issues.push(`${prefix}.payloadDigest is invalid`);
  }

  if (
    isPreCompletionPhase(certificate.preCompletionPhase) &&
    certificate.stateDigest !==
      completionStateDigest({
        ...state,
        version: certificate.stateVersion,
        phase: certificate.preCompletionPhase,
        status: "ACTIVE",
        completionCertificate: undefined,
      })
  ) {
    issues.push(`${prefix}.stateDigest does not match the certified pre-completion state`);
  }
}

function successContractDigestFor(state: SessionState): string {
  return digestCanonical({
    task: {
      id: state.task.id,
      repository: state.task.repository,
      revision: state.task.revision,
    },
    criteria: state.successCriteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      required: criterion.required,
      verifier: criterion.verifier,
      evidenceScope: criterion.evidenceScope,
    })),
  });
}

/**
 * Hash only the state that existed immediately before certificate issuance.
 * The projection deliberately omits the certificate itself and normalizes the
 * remaining object to the same shape that JSON persistence can round-trip.
 */
export function completionStateDigest(state: SessionState): string {
  const requiredIds = new Set(
    state.successCriteria.filter((criterion) => criterion.required).map((criterion) => criterion.id),
  );
  return digestCanonical(
    persistenceStable({
      version: state.version,
      task: state.task,
      phase: state.phase,
      status: state.status,
      successContractDigest: successContractDigestFor(state),
      requiredCriteria: state.successCriteria.filter((criterion) => criterion.required),
      verifierResults: state.verifierResults.filter((result) => requiredIds.has(result.criterionId)),
      evidenceIds: state.evidenceIds,
      patchDigest: state.patchDigest ?? null,
      reviewerVerdict: state.reviewerVerdict ?? null,
      reviewBinding: state.reviewBinding ?? null,
      approvals: state.approvals,
      operations: state.operations,
      latestRoundEvaluation: state.roundEvaluations.at(-1) ?? null,
      externalAction: state.externalAction ?? null,
      terminalSequenceNumber: state.terminalSequenceNumber ?? null,
      traceId: state.traceId,
    }),
  );
}

function isPreCompletionPhase(value: unknown): value is SessionState["phase"] {
  return (
    typeof value === "string" &&
    WORKFLOW_PHASES.includes(value as SessionState["phase"]) &&
    !Object.prototype.hasOwnProperty.call(TERMINAL_PHASE_STATUS, value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function persistenceStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => persistenceStable(entry));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, persistenceStable(entry)]),
  );
}

function isPullRequestIdentity(value: unknown): value is PullRequestIdentity {
  if (!isRecord(value)) return false;
  return [
    value.identifier,
    value.repository,
    value.base,
    value.head,
    value.headSha,
    value.operationId,
    value.idempotencyKey,
  ].every((field) => typeof field === "string" && field.trim().length > 0);
}

function timestampMillis(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}
