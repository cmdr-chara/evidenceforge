export const RISK_LEVELS = [
  "READ_ONLY",
  "SANDBOX_MUTATION",
  "EXTERNAL_REVERSIBLE",
  "EXTERNAL_DESTRUCTIVE",
  "PRIVILEGED",
  "UNKNOWN",
] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export const REPLAY_POLICIES = ["SAFE", "RECONCILE_FIRST", "NEVER"] as const;
export type ReplayPolicy = (typeof REPLAY_POLICIES)[number];

export const WORKFLOW_PHASES = [
  "INTAKE",
  "DEFINE_SUCCESS",
  "PLANNING",
  "INVESTIGATING",
  "REPRODUCING",
  "PATCHING",
  "VERIFYING",
  "REVIEWING",
  "RETRYING",
  "REPLANNING",
  "AWAITING_APPROVAL",
  "PUBLISHING",
  "COMPLETED",
  "BLOCKED",
  "ESCALATED",
  "FAILED",
] as const;

export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];

export type SessionStatus = "ACTIVE" | "COMPLETED" | "BLOCKED" | "ESCALATED" | "FAILED";
export type CriterionStatus = "PENDING" | "PASS" | "FAIL" | "INCONCLUSIVE";
export type VerificationStatus = "PASS" | "FAIL" | "INCONCLUSIVE";
export type ReviewerVerdict = "PASS" | "PASS_WITH_WARNINGS" | "BLOCK";

export const EVIDENCE_SCOPES = ["INCIDENT", "PATCH", "EXTERNAL"] as const;
export type EvidenceScope = (typeof EVIDENCE_SCOPES)[number];

export interface ArtifactBinding {
  taskId: string;
  repository: string;
  revision: string;
  successContractDigest: string;
  stateVersion: number;
  scope: EvidenceScope;
  patchDigest?: string;
}

export interface GitHubActionsIncidentSource {
  kind: "GITHUB_ACTIONS";
  runId: string;
  workflow?: string;
  failedJobIds?: string[];
}

export type IncidentSource = GitHubActionsIncidentSource;

export interface Task {
  id: string;
  objective: string;
  source: IncidentSource;
  repository: string;
  revision: string;
  constraints: string[];
  createdAt: string;
}

export interface CommandVerifierSpec {
  kind: "COMMAND";
  argv: string[];
  cwd: string;
  expectedExitCode: number;
  outputMustContain?: string[];
  timeoutSeconds: number;
  purpose: "VERIFICATION" | "REPRODUCTION";
}

export interface FailureSignatureVerifierSpec {
  kind: "FAILURE_SIGNATURE";
  argv: string[];
  cwd: string;
  expectedNonZeroExit: true;
  signature: string;
  timeoutSeconds: number;
}

export interface DiffIntegrityVerifierSpec {
  kind: "DIFF_INTEGRITY";
  cwd: string;
  timeoutSeconds: number;
}

export interface SchemaFileVerifierSpec {
  kind: "SCHEMA_FILE";
  artifactRef: string;
  schemaName: string;
}

export interface ReviewerVerifierSpec {
  kind: "REVIEWER";
  allowedVerdicts: Array<"PASS" | "PASS_WITH_WARNINGS">;
}

export interface ExternalStateVerifierSpec {
  kind: "EXTERNAL_STATE";
  actionType: "pull_request";
  expectedHeadSha?: string;
}

export type VerifierSpec =
  | CommandVerifierSpec
  | FailureSignatureVerifierSpec
  | DiffIntegrityVerifierSpec
  | SchemaFileVerifierSpec
  | ReviewerVerifierSpec
  | ExternalStateVerifierSpec;

export interface SuccessCriterion {
  id: string;
  description: string;
  required: boolean;
  verifier: VerifierSpec;
  evidenceScope: EvidenceScope;
  status: CriterionStatus;
  evidenceIds: string[];
}

export interface Plan {
  version: number;
  steps: PlanStep[];
}

export interface PlanStep {
  id: string;
  objective: string;
  dependencies: string[];
  owner: string;
  expectedEvidence: string[];
  riskCeiling: RiskLevel;
  status: "PENDING" | "RUNNING" | "DONE" | "INVALIDATED" | "FAILED";
  attempts: number;
}

export interface Hypothesis {
  id: string;
  statement: string;
  status: "OPEN" | "SUPPORTED" | "REFUTED" | "CONFIRMED";
  supportingEvidence: string[];
  contradictingEvidence: string[];
}

export type EvidenceKind =
  | "OBSERVATION"
  | "REPRODUCTION"
  | "VERIFICATION"
  | "REVIEW"
  | "EXTERNAL_RESULT";

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  sourceEventId: string;
  sourceTool: string;
  claim: string;
  artifactRefs: string[];
  outcome?: VerificationStatus;
  timestamp: string;
  binding?: ArtifactBinding;
  metadata?: Record<string, string | number | boolean | null>;
}

export type RuntimeEventType =
  | "TOOL_RESULT"
  | "MODEL_MESSAGE"
  | "STATE_TRANSITION"
  | "APPROVAL"
  | "EXTERNAL_RECONCILIATION"
  | "THREAD_CREATED"
  | "THREAD_DONE"
  | "TURN_CREATED"
  | "TURN_DONE"
  | "SANDBOX_CREATED"
  | "AUTH_REQUIRED";

export interface RuntimeEvent {
  id: string;
  type: RuntimeEventType;
  source: string;
  threadId?: string;
  timestamp: string;
  payload: unknown;
  sequenceNumber?: number;
}

export interface ToolResult {
  callId: string;
  eventId: string;
  tool: string;
  status: "OK" | "ERROR" | "DENIED" | "TIMEOUT";
  retryable: boolean;
  errorCode?: string;
  artifactRefs: string[];
  evidenceIds: string[];
  durationMs: number;
  exitCode?: number;
  stdoutPreview?: string;
  stderrPreview?: string;
}

export interface VerificationResult {
  criterionId: string;
  status: VerificationStatus;
  verifier: string;
  evidenceIds: string[];
  details: string;
  deterministic: boolean;
  binding?: ArtifactBinding;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  normalizedArguments: unknown;
  risk: RiskLevel;
  reason: string;
  reversible: boolean;
  status: "PENDING" | "APPROVED" | "DENIED";
  toolCallId?: string;
  threadId?: string;
  provenance?: ApprovalProvenance;
}

export interface ApprovalProvenance {
  actionDigest: string;
  repository: string;
  revision: string;
  risk: RiskLevel;
  originatingOperationId: string;
  binding?: ArtifactBinding;
  issuedAt: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface AgentResult {
  agent: string;
  findings: string[];
  hypotheses: string[];
  evidenceIds: string[];
  unresolvedQuestions: string[];
}

export interface PullRequestIdentity {
  identifier: string;
  repository: string;
  base: string;
  head: string;
  headSha: string;
  operationId: string;
  idempotencyKey: string;
}

export interface ExternalActionState {
  type: "pull_request";
  idempotencyKey: string;
  operationId: string;
  replayPolicy: "RECONCILE_FIRST";
  preparedArguments: {
    repository: string;
    base: string;
    head: string;
    title: string;
    body: string;
    expectedHeadSha: string;
  };
  binding: ArtifactBinding;
  status: "PREPARED" | "APPROVED" | "DENIED" | "COMMITTED" | "RECONCILED";
  identifier?: string;
  evidenceId?: string;
  reconciledIdentity?: PullRequestIdentity;
}

export type OperationStatus =
  | "INTENT_DURABLE"
  | "EFFECT_STARTED"
  | "EFFECT_UNCERTAIN"
  | "SETTLED";

export interface OperationRecord {
  id: string;
  actionType: string;
  tool: string;
  normalizedArguments: unknown;
  argumentDigest: string;
  repository: string;
  revision: string;
  risk: RiskLevel;
  replayPolicy: ReplayPolicy;
  expectedEvidence: string[];
  idempotencyKey?: string;
  status: OperationStatus;
  intentPersistedAt: string;
  effectStartedAt?: string;
  uncertainAt?: string;
  settlement?: OperationSettlement;
}

export interface OperationSettlement {
  authoritativeResult: unknown;
  runtimeEventId: string;
  evidenceIds: string[];
  nextWorkflowState: WorkflowPhase;
  settledAt: string;
}

export interface RoundCriterionEvaluation {
  criterionId: string;
  status: CriterionStatus;
  admissibleEvidenceIds: string[];
  missingEvidence: string[];
}

export type NextWorkflowAction =
  | "CONTINUE"
  | "VERIFY"
  | "RETRY"
  | "REPLAN"
  | "BLOCK"
  | "ESCALATE"
  | "COMPLETE_CANDIDATE";

export interface RoundProgressEvaluation {
  id: string;
  kind: "PATCH" | "REPLAN" | "VERIFICATION";
  sessionVersion: number;
  patchDigest?: string;
  criteria: RoundCriterionEvaluation[];
  deterministicFailures: string[];
  missingEvidence: string[];
  nextAction: NextWorkflowAction;
  evaluatedAt: string;
}

export interface ToolAttemptRecord {
  id: string;
  fingerprint: string;
  tool: string;
  normalizedArguments: unknown;
  workspaceRevision: string;
  resultSignature: string;
  evidenceIds: string[];
  stateDigest: string;
  outcome: "PROGRESS" | "RECONSIDER" | "REPLAN" | "ESCALATE";
  timestamp: string;
}

export interface SessionState {
  version: number;
  task: Task;
  phase: WorkflowPhase;
  plan: Plan;
  successCriteria: SuccessCriterion[];
  hypotheses: Hypothesis[];
  evidenceIds: string[];
  approvals: ApprovalRequest[];
  verifierResults: VerificationResult[];
  operations: OperationRecord[];
  roundEvaluations: RoundProgressEvaluation[];
  toolAttempts: ToolAttemptRecord[];
  patchAttempts: number;
  replanAttempts: number;
  transientAttempts: number;
  status: SessionStatus;
  reviewerVerdict?: ReviewerVerdict;
  reviewBinding?: ArtifactBinding;
  patchDigest?: string;
  traceId: string;
  trueForgeSessionId?: string;
  activeTurnId?: string;
  lastSequenceNumber?: number;
  terminalSequenceNumber?: number;
  livePullRequestHead?: string;
  externalAction?: ExternalActionState;
  blockedReason?: string;
  completionCertificate?: CompletionCertificateData;
}

/** Pull-request target used by live sessions before the target became configurable. */
export const DEFAULT_LIVE_PULL_REQUEST_HEAD = "feat/foundation-control-plane";

export interface CompletionCertificateData {
  certificateVersion: 2;
  taskId: string;
  repository: string;
  revision: string;
  stateVersion: number;
  preCompletionPhase: WorkflowPhase;
  successContractDigest: string;
  stateDigest: string;
  requiredCriteria: Array<{
    criterionId: string;
    result: "PASS";
    evidenceIds: string[];
  }>;
  originalFailureReproduced: boolean;
  patchDigest: string;
  reviewerVerdict: "PASS" | "PASS_WITH_WARNINGS";
  externalAction?: PullRequestIdentity & {
    type: "pull_request";
    evidenceId: string;
  };
  subjectDigest: string;
  payloadDigest: string;
  traceId: string;
  generatedAt: string;
}

export interface GateFailure {
  code:
    | "REQUIRED_CRITERION_NOT_PASSING"
    | "MISSING_ADMISSIBLE_EVIDENCE"
    | "DETERMINISTIC_FAILURE"
    | "REVIEW_BLOCKED"
    | "PATCH_DIGEST_MISSING"
    | "ORIGINAL_FAILURE_NOT_REPRODUCED"
    | "EXTERNAL_ACTION_NOT_RECONCILED"
    | "ROUND_VERIFICATION_MISSING_OR_STALE"
    | "UNCERTAIN_OPERATION_UNRESOLVED";
  message: string;
  criterionId?: string;
}

export type GateDecision =
  | { allowed: true; certificate: CompletionCertificateData }
  | { allowed: false; failures: GateFailure[] };
