import {
  ApprovalRequest,
  CompletionCertificateData,
  Hypothesis,
  SessionState,
  VerificationResult,
  WorkflowPhase,
} from "../../domain/src/types";
import { validateSessionState } from "../../domain/src/validation";
import { isIssuedCompletionCertificate } from "../../verification/src/completion-gate";

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
      throw new InvalidTransitionError("completion certificate was not issued by CompletionGate");
    }
    if (certificate.taskId !== this.state.task.id) {
      throw new InvalidTransitionError("certificate task does not match session task");
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
    this.state.verifierResults.push(structuredClone(result));
    criterion.status = result.status;
    criterion.evidenceIds = [...new Set([...criterion.evidenceIds, ...result.evidenceIds])];
    this.state.evidenceIds = [...new Set([...this.state.evidenceIds, ...result.evidenceIds])];
    this.state.version += 1;
    return this.snapshot();
  }

  public setPatchDigest(digest: string): SessionState {
    if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error("patch digest must be a SHA-256 hex string");
    this.state.patchDigest = digest.toLowerCase();
    this.state.version += 1;
    return this.snapshot();
  }

  public setReviewerVerdict(verdict: SessionState["reviewerVerdict"]): SessionState {
    this.state.reviewerVerdict = verdict;
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
}
