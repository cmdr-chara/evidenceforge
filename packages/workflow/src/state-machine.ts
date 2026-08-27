import {
  ApprovalRequest,
  CompletionCertificateData,
  Hypothesis,
  SessionState,
  VerificationResult,
  WorkflowPhase,
} from "../../domain/src/types";
import { validateSessionState } from "../../domain/src/validation";
import {
  artifactBindingFor,
  artifactBindingMatchesState,
  completionStateDigest,
  completionSubjectDigest,
  isIssuedCompletionCertificate,
  successContractDigest,
} from "../../verification/src";

export type TransitionActor = "APPLICATION" | "MODEL";

const TRANSITIONS: Record<WorkflowPhase, readonly WorkflowPhase[]> = {
  INTAKE: ["DEFINE_SUCCESS", "BLOCKED", "FAILED"],
  DEFINE_SUCCESS: ["PLANNING", "BLOCKED", "FAILED"],
  PLANNING: ["INVESTIGATING", "BLOCKED", "FAILED"],
  INVESTIGATING: ["REPRODUCING", "REPLANNING", "BLOCKED", "ESCALATED", "FAILED"],
  REPRODUCING: ["PATCHING", "REPLANNING", "BLOCKED", "ESCALATED", "FAILED"],
  PATCHING: ["VERIFYING", "RETRYING", "REPLANNING", "BLOCKED", "ESCALATED", "FAILED"],
  VERIFYING: ["REVIEWING", "RETRYING", "REPLANNING", "BLOCKED", "ESCALATED", "FAILED"],
  REVIEWING: ["AWAITING_APPROVAL", "PUBLISHING", "RETRYING", "REPLANNING", "BLOCKED", "ESCALATED"],
  RETRYING: ["PATCHING", "REPRODUCING", "VERIFYING", "REPLANNING", "ESCALATED", "BLOCKED"],
  REPLANNING: ["INVESTIGATING", "REPRODUCING", "PATCHING", "ESCALATED", "BLOCKED"],
  AWAITING_APPROVAL: ["PUBLISHING", "BLOCKED", "ESCALATED"],
  PUBLISHING: ["AWAITING_APPROVAL", "BLOCKED", "ESCALATED", "FAILED"],
  COMPLETED: [],
  BLOCKED: [],
  ESCALATED: [],
  FAILED: [],
};

export class InvalidTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export class SessionController {
  private state: SessionState;

  public constructor(initialState: SessionState) {
    this.state = structuredClone(validateSessionState(initialState));
  }

  public snapshot(): SessionState {
    return structuredClone(this.state);
  }

  public transition(next: WorkflowPhase, actor: TransitionActor, reason: string): SessionState {
    if (next === "COMPLETED") {
      throw new InvalidTransitionError(
        "COMPLETED can only be reached through completeWithCertificate",
      );
    }
    if (actor === "MODEL" && ["BLOCKED", "ESCALATED", "FAILED"].includes(next)) {
      throw new InvalidTransitionError("model output cannot directly set terminal workflow state");
    }
    if (!TRANSITIONS[this.state.phase].includes(next)) {
      throw new InvalidTransitionError(`cannot transition ${this.state.phase} -> ${next}: ${reason}`);
    }
    this.state.phase = next;
    if (next === "BLOCKED") {
      this.state.status = "BLOCKED";
      this.state.blockedReason = reason;
    } else if (next === "ESCALATED") {
      this.state.status = "ESCALATED";
      this.state.blockedReason = reason;
    }
    this.state.version += 1;
    return this.snapshot();
  }

  public completeWithCertificate(certificate: CompletionCertificateData): SessionState {
    if (!isIssuedCompletionCertificate(certificate)) {
      throw new InvalidTransitionError("completion certificate is fabricated or its payload changed");
    }
    if (
      certificate.taskId !== this.state.task.id ||
      certificate.repository !== this.state.task.repository ||
      certificate.revision !== this.state.task.revision ||
      certificate.patchDigest !== this.state.patchDigest ||
      certificate.stateVersion !== this.state.version ||
      certificate.successContractDigest !== successContractDigest(this.state) ||
      certificate.stateDigest !== completionStateDigest(this.state) ||
      certificate.subjectDigest !== completionSubjectDigest(this.state)
    ) {
      throw new InvalidTransitionError("completion certificate subject no longer matches session state");
    }
    this.state.phase = "COMPLETED";
    this.state.status = "COMPLETED";
    this.state.completionCertificate = structuredClone(certificate);
    this.state.version += 1;
    return this.snapshot();
  }

  public applyVerification(result: VerificationResult): SessionState {
    const criterion = this.state.successCriteria.find((item) => item.id === result.criterionId);
    if (criterion === undefined) {
      throw new Error(`unknown success criterion: ${result.criterionId}`);
    }
    const boundResult = structuredClone(result);
    boundResult.binding ??= artifactBindingFor(this.state, criterion.evidenceScope);
    this.state.verifierResults.push(boundResult);
    criterion.status = boundResult.status;
    criterion.evidenceIds = [...new Set([...criterion.evidenceIds, ...boundResult.evidenceIds])];
    this.state.evidenceIds = [...new Set([...this.state.evidenceIds, ...boundResult.evidenceIds])];
    this.state.version += 1;
    return this.snapshot();
  }

  public setPatchDigest(digest: string): SessionState {
    if (this.state.status !== "ACTIVE") {
      throw new Error("patch digest can change only while the session is active");
    }
    if (!/^[a-f0-9]{64}$/i.test(digest)) {
      throw new Error("patch digest must be a SHA-256 hex string");
    }
    const normalized = digest.toLowerCase();
    if (this.state.patchDigest === normalized) return this.snapshot();
    if (
      this.state.externalAction?.status === "COMMITTED" ||
      this.state.externalAction?.status === "RECONCILED"
    ) {
      throw new Error("cannot replace a patch after its external action was committed");
    }
    this.invalidatePatchBoundState();
    this.state.patchDigest = normalized;
    this.state.version += 1;
    return this.snapshot();
  }

  public setReviewerVerdict(verdict: SessionState["reviewerVerdict"]): SessionState {
    this.state.reviewerVerdict = verdict;
    this.state.reviewBinding =
      verdict === undefined ? undefined : artifactBindingFor(this.state, "PATCH");
    this.state.version += 1;
    return this.snapshot();
  }

  public addApproval(approval: ApprovalRequest): SessionState {
    if (this.state.approvals.some((item) => item.id === approval.id)) {
      throw new Error(`duplicate approval request: ${approval.id}`);
    }
    this.state.approvals.push(structuredClone(approval));
    this.state.version += 1;
    return this.snapshot();
  }

  public decideApproval(id: string, decision: "APPROVED" | "DENIED"): SessionState {
    const approval = this.state.approvals.find((item) => item.id === id);
    if (approval === undefined) throw new Error(`unknown approval request: ${id}`);
    if (approval.status !== "PENDING") throw new Error(`approval ${id} is already decided`);
    if (
      approval.provenance !== undefined &&
      !artifactBindingMatchesState(approval.provenance.binding, this.state, "EXTERNAL")
    ) {
      throw new Error(`approval ${id} is stale for the current patch`);
    }
    approval.status = decision;
    this.state.version += 1;
    return this.snapshot();
  }

  public upsertHypothesis(hypothesis: Hypothesis): SessionState {
    const index = this.state.hypotheses.findIndex((item) => item.id === hypothesis.id);
    if (index === -1) this.state.hypotheses.push(structuredClone(hypothesis));
    else this.state.hypotheses[index] = structuredClone(hypothesis);
    this.state.version += 1;
    return this.snapshot();
  }

  public replaceState(state: SessionState): void {
    this.state = structuredClone(validateSessionState(state));
  }

  private invalidatePatchBoundState(): void {
    const invalidCriterionIds = new Set(
      this.state.successCriteria
        .filter((criterion) => criterion.evidenceScope !== "INCIDENT")
        .map((criterion) => criterion.id),
    );
    const invalidEvidenceIds = new Set<string>();
    for (const criterion of this.state.successCriteria) {
      if (!invalidCriterionIds.has(criterion.id)) continue;
      for (const evidenceId of criterion.evidenceIds) invalidEvidenceIds.add(evidenceId);
      criterion.status = "PENDING";
      criterion.evidenceIds = [];
    }
    this.state.verifierResults = this.state.verifierResults.filter(
      (result) => !invalidCriterionIds.has(result.criterionId),
    );
    this.state.evidenceIds = this.state.evidenceIds.filter((id) => !invalidEvidenceIds.has(id));
    this.state.roundEvaluations = [];
    this.state.reviewerVerdict = undefined;
    this.state.reviewBinding = undefined;

    const invalidOperationIds = new Set<string>();
    for (const approval of this.state.approvals) {
      if (approval.provenance?.binding?.scope === "EXTERNAL") {
        invalidOperationIds.add(approval.provenance.originatingOperationId);
      }
    }
    if (this.state.externalAction !== undefined) {
      invalidOperationIds.add(this.state.externalAction.operationId);
    }
    this.state.approvals = this.state.approvals.filter(
      (approval) => approval.provenance?.binding?.scope !== "EXTERNAL",
    );
    this.state.operations = this.state.operations.filter(
      (operation) => !invalidOperationIds.has(operation.id),
    );
    this.state.externalAction = undefined;
    this.state.completionCertificate = undefined;
  }
}
