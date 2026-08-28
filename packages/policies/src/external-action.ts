import { createHash, randomUUID } from "node:crypto";
import {
  ApprovalRequest,
  ArtifactBinding,
  digestCanonical,
  ExternalActionState,
  PullRequestIdentity,
  RuntimeEvent,
  SessionState,
} from "../../domain/src";
import { createEvidence, EvidenceStore } from "../../evidence/src";
import { artifactBindingMatchesState } from "../../verification/src";
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
  binding: ArtifactBinding;
  now?: string;
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
    if (
      input.binding.scope !== "EXTERNAL" ||
      input.binding.repository !== input.repository ||
      input.binding.patchDigest !== input.patchDigest
    ) {
      throw new Error("pull-request preparation binding does not match repository and patch");
    }
    const preparedArguments = {
      repository: input.repository,
      base: input.base,
      head: input.head,
      title: input.title,
      body: input.body,
      expectedHeadSha: input.expectedHeadSha,
    };
    const actionDigest = digestCanonical(preparedArguments);
    const idempotencyKey = createHash("sha256")
      .update(`${input.sessionId}:${input.patchDigest}:${actionDigest}`)
      .digest("hex");
    const operationId = `operation-pr-${idempotencyKey.slice(0, 20)}`;
    const action: ExternalActionState = {
      type: "pull_request",
      idempotencyKey,
      operationId,
      replayPolicy: "RECONCILE_FIRST",
      preparedArguments: structuredClone(preparedArguments),
      binding: structuredClone(input.binding),
      status: "PREPARED",
    };
    const issuedAt = input.now ?? new Date().toISOString();
    const approval: ApprovalRequest = {
      id: `approval-${randomUUID()}`,
      action: "github.create_pull_request",
      normalizedArguments: structuredClone(preparedArguments),
      risk: "EXTERNAL_REVERSIBLE",
      reason: "Creating a pull request changes external repository state",
      reversible: true,
      status: "PENDING",
      provenance: {
        actionDigest,
        repository: input.repository,
        revision: input.expectedHeadSha,
        risk: "EXTERNAL_REVERSIBLE",
        originatingOperationId: operationId,
        binding: structuredClone(input.binding),
        issuedAt,
        expiresAt: new Date(Date.parse(issuedAt) + 15 * 60 * 1_000).toISOString(),
      },
    };
    return { action, approval };
  }

  public applyApproval(
    action: ExternalActionState,
    approval: ApprovalRequest,
    now = new Date().toISOString(),
  ): ExternalActionState {
    if (action.status !== "PREPARED") {
      throw new Error("approval can only be applied to a PREPARED action");
    }
    if (approval.action !== "github.create_pull_request" || approval.risk !== "EXTERNAL_REVERSIBLE") {
      throw new Error("approval does not authorize pull-request creation");
    }
    const expectedDigest = digestCanonical(action.preparedArguments);
    if (digestCanonical(approval.normalizedArguments) !== expectedDigest) {
      throw new Error("approved arguments do not match the prepared pull request");
    }
    const provenance = approval.provenance;
    if (
      provenance === undefined ||
      provenance.actionDigest !== expectedDigest ||
      provenance.repository !== action.preparedArguments.repository ||
      provenance.revision !== action.preparedArguments.expectedHeadSha ||
      provenance.risk !== approval.risk ||
      provenance.originatingOperationId !== action.operationId ||
      digestCanonical(provenance.binding) !== digestCanonical(action.binding)
    ) {
      throw new Error("approval provenance does not match the prepared action");
    }
    if (provenance.consumedAt !== undefined) throw new Error("approval provenance was already consumed");
    const issuedAt = timestampMillis(provenance.issuedAt);
    const expiresAt = timestampMillis(provenance.expiresAt);
    const currentTime = timestampMillis(now);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(currentTime)) {
      throw new Error("approval provenance contains malformed timestamps");
    }
    if (expiresAt <= issuedAt) {
      throw new Error("approval provenance expiry is malformed");
    }
    if (expiresAt <= currentTime) throw new Error("approval provenance expired");
    const authorization = this.approvalPolicy.authorize(approval);
    if (!authorization.allowed) {
      return { ...structuredClone(action), status: "DENIED" };
    }
    provenance.consumedAt = now;
    return { ...structuredClone(action), status: "APPROVED" };
  }

  public markCommitted(action: ExternalActionState): ExternalActionState {
    if (action.status !== "APPROVED") {
      throw new Error("external action must be approved before commit");
    }
    return { ...structuredClone(action), status: "COMMITTED" };
  }

  public mustReconcileBeforeRetry(action: ExternalActionState): boolean {
    return action.status === "APPROVED" || action.status === "COMMITTED";
  }

  public reconcile(
    state: SessionState,
    event: RuntimeEvent,
    observed: PullRequestIdentity,
  ): ExternalActionState {
    const action = state.externalAction;
    if (action === undefined) throw new Error("no external action is present");
    if (action.status !== "COMMITTED" && action.status !== "RECONCILED") {
      throw new Error("external reconciliation requires a committed approved action");
    }
    if (event.type !== "EXTERNAL_RECONCILIATION") {
      throw new Error("external reconciliation requires a reconciliation runtime event");
    }
    if (!artifactBindingMatchesState(action.binding, state, "EXTERNAL")) {
      throw new Error("external action binding is stale for the current task or patch");
    }
    if (action.status === "RECONCILED") {
      if (
        action.identifier === undefined ||
        action.evidenceId === undefined ||
        action.reconciledIdentity === undefined ||
        action.identifier !== observed.identifier ||
        !pullRequestIdentityMatches(action.reconciledIdentity, observed)
      ) {
        throw new Error("reconciled pull request identity conflicts with the existing result");
      }
      return structuredClone(action);
    }
    if (this.evidenceStore === undefined) {
      throw new Error("evidence store is required for reconciliation");
    }
    const expected = action.preparedArguments;
    if (
      observed.repository !== expected.repository ||
      observed.base !== expected.base ||
      observed.head !== expected.head ||
      observed.headSha !== expected.expectedHeadSha ||
      observed.operationId !== action.operationId ||
      observed.idempotencyKey !== action.idempotencyKey
    ) {
      throw new Error("reconciled pull request does not match the exact prepared identity");
    }
    const evidence = createEvidence({
      kind: "EXTERNAL_RESULT",
      sourceEventId: event.id,
      sourceTool: "github-mcp.reconcile-pull-request",
      claim: `GitHub confirmed pull request ${observed.identifier} at ${observed.headSha}`,
      outcome: "PASS",
      binding: action.binding,
      metadata: {
        identifier: observed.identifier,
        repository: observed.repository,
        base: observed.base,
        head: observed.head,
        headSha: observed.headSha,
        operationId: observed.operationId,
        idempotencyKey: observed.idempotencyKey,
      },
    });
    this.evidenceStore.recordEvidence(evidence);
    return {
      ...structuredClone(action),
      status: "RECONCILED",
      identifier: observed.identifier,
      evidenceId: evidence.id,
      reconciledIdentity: structuredClone(observed),
    };
  }
}

function pullRequestIdentityMatches(
  actual: PullRequestIdentity,
  expected: PullRequestIdentity,
): boolean {
  return (
    actual.identifier === expected.identifier &&
    actual.repository === expected.repository &&
    actual.base === expected.base &&
    actual.head === expected.head &&
    actual.headSha === expected.headSha &&
    actual.operationId === expected.operationId &&
    actual.idempotencyKey === expected.idempotencyKey
  );
}

function timestampMillis(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}
