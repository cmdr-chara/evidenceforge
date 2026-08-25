import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  ApprovalRequest,
  ExternalActionState,
  RuntimeEvent,
  SessionState,
} from "../../domain/src/types";
import { digestCanonical } from "../../domain/src/canonical";
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
  now?: string;
  approvalTtlMs?: number;
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
    const operationId = `operation-${idempotencyKey.slice(0, 24)}`;
    const action: ExternalActionState = {
      type: "pull_request",
      idempotencyKey,
      operationId,
      replayPolicy: "RECONCILE_FIRST",
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
    const issuedAt = input.now ?? new Date().toISOString();
    const expiresAt = new Date(
      Date.parse(issuedAt) + (input.approvalTtlMs ?? 15 * 60 * 1_000),
    ).toISOString();
    const approval: ApprovalRequest = {
      id: `approval-${randomUUID()}`,
      action: "github.create_pull_request",
      normalizedArguments: structuredClone(action.preparedArguments),
      risk: "EXTERNAL_REVERSIBLE",
      reason: "Creating a pull request is an externally visible GitHub write",
      reversible: true,
      status: "PENDING",
      provenance: {
        actionDigest: digestCanonical(action.preparedArguments),
        repository: input.repository,
        revision: input.expectedHeadSha,
        risk: "EXTERNAL_REVERSIBLE",
        originatingOperationId: operationId,
        issuedAt,
        expiresAt,
      },
    };
    return { action, approval };
  }

  public applyApproval(
    action: ExternalActionState,
    approval: ApprovalRequest,
    now = new Date().toISOString(),
  ): ExternalActionState {
    assertApprovalMatches(action, approval, now);
    const outcome = this.approvalPolicy.authorize(approval);
    if (!outcome.allowed) {
      return { ...action, status: approval.status === "DENIED" ? "DENIED" : action.status };
    }
    if (approval.provenance !== undefined) approval.provenance.consumedAt = now;
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

function assertApprovalMatches(
  action: ExternalActionState,
  approval: ApprovalRequest,
  now: string,
): void {
  if (action.status !== "PREPARED") {
    throw new Error(`approval can only be applied to a PREPARED action, received ${action.status}`);
  }
  if (approval.action !== "github.create_pull_request") {
    throw new Error(`approval action ${approval.action} does not authorize pull-request creation`);
  }
  if (approval.risk !== "EXTERNAL_REVERSIBLE" || !approval.reversible) {
    throw new Error("approval risk metadata does not match pull-request creation policy");
  }
  if (!isDeepStrictEqual(approval.normalizedArguments, action.preparedArguments)) {
    throw new Error("approval arguments do not match the prepared pull-request action");
  }
  const provenance = approval.provenance;
  if (provenance === undefined) throw new Error("external approval is missing provenance");
  if (provenance.consumedAt !== undefined) throw new Error("approval has already been consumed");
  if (Date.parse(now) >= Date.parse(provenance.expiresAt)) throw new Error("approval has expired");
  if (
    provenance.actionDigest !== digestCanonical(action.preparedArguments) ||
    provenance.repository !== action.preparedArguments.repository ||
    provenance.revision !== action.preparedArguments.expectedHeadSha ||
    provenance.risk !== approval.risk ||
    provenance.originatingOperationId !== action.operationId
  ) {
    throw new Error("approval provenance does not match the prepared operation");
  }
}
