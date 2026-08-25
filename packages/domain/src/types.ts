export const RISK_LEVELS = [
  "READ_ONLY",
  "SANDBOX_MUTATION",
  "EXTERNAL_REVERSIBLE",
  "EXTERNAL_DESTRUCTIVE",
  "PRIVILEGED",
  "UNKNOWN",
] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

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

export type SessionStatus = "ACTIVE" | "COMPLETED" | "BLOCKED" | "ESCALATED";
export type CriterionStatus = "PENDING" | "PASS" | "FAIL" | "INCONCLUSIVE";
export type VerificationStatus = "PASS" | "FAIL" | "INCONCLUSIVE";
export type ReviewerVerdict = "PASS" | "PASS_WITH_WARNINGS" | "BLOCK";

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
}

export interface AgentResult {
  agent: string;
  findings: string[];
  hypotheses: string[];
  evidenceIds: string[];
  unresolvedQuestions: string[];
}

export interface ExternalActionState {
  type: "pull_request";
  idempotencyKey: string;
  preparedArguments: {
    repository: string;
    base: string;
    head: string;
    title: string;
    body: string;
    expectedHeadSha: string;
  };
  status: "PREPARED" | "APPROVED" | "DENIED" | "COMMITTED" | "RECONCILED";
  identifier?: string;
  evidenceId?: string;
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
  patchAttempts: number;
  replanAttempts: number;
  transientAttempts: number;
  status: SessionStatus;
  reviewerVerdict?: ReviewerVerdict;
  patchDigest?: string;
  traceId: string;
  trueForgeSessionId?: string;
  activeTurnId?: string;
  lastSequenceNumber?: number;
  externalAction?: ExternalActionState;
  blockedReason?: string;
  completionCertificate?: CompletionCertificateData;
}

export interface CompletionCertificateData {
  taskId: string;
  requiredCriteria: Array<{
    criterionId: string;
    result: "PASS";
    evidenceIds: string[];
  }>;
  originalFailureReproduced: boolean;
  patchDigest: string;
  reviewerVerdict: "PASS" | "PASS_WITH_WARNINGS";
  externalAction?: {
    type: "pull_request";
    identifier: string;
    evidenceId: string;
  };
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
    | "EXTERNAL_ACTION_NOT_RECONCILED";
  message: string;
  criterionId?: string;
}

export type GateDecision =
  | { allowed: true; certificate: CompletionCertificateData }
  | { allowed: false; failures: GateFailure[] };
