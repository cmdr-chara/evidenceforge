import { createHash, randomUUID } from "node:crypto";
import {
  ApprovalRequest,
  ExternalActionState,
  RuntimeEvent,
  SessionState,
} from "../../domain/src/types";
import { createEvidence, EvidenceStore } from "../../evidence/src";
import { ApprovalPolicy } from "./approval-policy";

export interface PreparePullRequestInput {
  sessionId: string;
  repository: string;
  base: string;
  head: string;
  title: string;
  body: string;
  expectedHeadSha: string;
  patchDigest: string;
}

export class ExternalActionCoordinator {
  public constructor(
    private readonly approvalPolicy = new ApprovalPolicy(),
    private readonly evidenceStore?: EvidenceStore,
  ) {}

  public preparePullRequest(input: PreparePullRequestInput): {
    action: ExternalActionState;
    approval: ApprovalRequest;
  } {
    const idempotencyKey = createHash("sha256")
      .update(`${input.sessionId}:${input.patchDigest}`)
      .digest("hex");
    const action: ExternalActionState = {
      type: "pull_request",
      idempotencyKey,
      preparedArguments: {
        repository: input.repository,
        base: input.base,
        head: input.head,
        title: input.title,
        body: input.body,
        expectedHeadSha: input.expectedHeadSha,
      },
      status: "PREPARED",
    };
    const approval: ApprovalRequest = {
      id: `approval-${randomUUID()}`,
      action: "github.create_pull_request",
      normalizedArguments: action.preparedArguments,
      risk: "EXTERNAL_REVERSIBLE",
      reason: "Creating a pull request is an externally visible GitHub write",
      reversible: true,
      status: "PENDING",
    };
    return { action, approval };
  }

  public applyApproval(action: ExternalActionState, approval: ApprovalRequest): ExternalActionState {
    const outcome = this.approvalPolicy.authorize(approval);
    if (!outcome.allowed) {
      return { ...action, status: approval.status === "DENIED" ? "DENIED" : action.status };
    }
    return { ...action, status: "APPROVED" };
  }

  public markCommitted(action: ExternalActionState): ExternalActionState {
    if (action.status !== "APPROVED") {
      throw new Error("external action cannot commit before approval");
    }
    return { ...action, status: "COMMITTED" };
  }

  public reconcile(
    state: SessionState,
    event: RuntimeEvent,
    identifier: string,
    observedHeadSha: string,
  ): ExternalActionState {
    const action = state.externalAction;
    if (action === undefined || (action.status !== "COMMITTED" && action.status !== "APPROVED")) {
      throw new Error("external action must be approved or committed before reconciliation");
    }
    if (event.type !== "EXTERNAL_RECONCILIATION") {
      throw new Error("external state must be confirmed by a reconciliation event");
    }
    if (observedHeadSha !== action.preparedArguments.expectedHeadSha) {
      throw new Error(
        `reconciled head ${observedHeadSha} differs from expected ${action.preparedArguments.expectedHeadSha}`,
      );
    }
    const evidence = createEvidence({
      kind: "EXTERNAL_RESULT",
      sourceEventId: event.id,
      sourceTool: "github-mcp.reconcile-pull-request",
      claim: `GitHub confirmed pull request ${identifier} at ${observedHeadSha}`,
      outcome: "PASS",
      metadata: { identifier, observedHeadSha, idempotencyKey: action.idempotencyKey },
    });
    this.evidenceStore?.recordEvidence(evidence);
    return {
      ...action,
      status: "RECONCILED",
      identifier,
      evidenceId: evidence.id,
    };
  }

  public mustReconcileBeforeRetry(action: ExternalActionState): boolean {
    return action.status === "COMMITTED" || action.status === "APPROVED";
  }
}
