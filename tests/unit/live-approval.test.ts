import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLiveApprovalReady } from "../../apps/server/src/live-service";
import { validateCreatePullRequestCall } from "../../apps/server/src/github-mcp-adapter";
import { ApprovalRequest, digestCanonical } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import {
  artifactBindingFor,
  artifactBindingMatchesState,
} from "../../packages/verification/src";
import { createOperationIntent } from "../../packages/workflow/src";
import { buildState, passAll } from "../fixtures/builders";

function approval(
  state: ReturnType<typeof buildState>,
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  const [owner, repo] = state.task.repository.split("/");
  assert.ok(owner);
  assert.ok(repo);
  const normalizedArguments = {
    owner,
    repo,
    base: "determination",
    head: "fix/demo",
    title: "docs: record live proof",
    body: "Documentation-only external-write proof.",
  };
  return {
    id: "approval-live-pr",
    action: "github.create_pull_request",
    normalizedArguments,
    risk: "EXTERNAL_REVERSIBLE",
    reason: "external write",
    reversible: true,
    status: "PENDING",
    toolCallId: "call-pr",
    threadId: "main",
    provenance: {
      actionDigest: digestCanonical(normalizedArguments),
      repository: state.task.repository,
      revision: state.task.revision,
      risk: "EXTERNAL_REVERSIBLE",
      originatingOperationId: "operation-live-pr",
      binding: artifactBindingFor(state, "EXTERNAL"),
      issuedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    ...overrides,
  };
}

function readyState() {
  const state = buildState();
  const evidence = new EvidenceStore();
  passAll(state, evidence);
  const pending = approval(state);
  state.operations.push(
    createOperationIntent({
      id: "operation-live-pr",
      actionType: "github.create_pull_request",
      tool: "github.create_pull_request",
      normalizedArguments: pending.normalizedArguments,
      repository: state.task.repository,
      revision: state.task.revision,
      risk: "EXTERNAL_REVERSIBLE",
      replayPolicy: "RECONCILE_FIRST",
      expectedEvidence: ["pull request"],
    }),
  );
  state.approvals.push(pending);
  state.phase = "AWAITING_APPROVAL";
  return { state, evidence, pending };
}

test("live PR approval requires verified pre-publish state", () => {
  const { state, evidence, pending } = readyState();
  assert.doesNotThrow(() => assertLiveApprovalReady(state, pending, evidence));
});

test("live PR approval accepts bound optional GitHub fields on a prepared action", () => {
  const { state, evidence, pending } = readyState();
  const normalizedArguments = {
    ...pending.normalizedArguments as Record<string, unknown>,
    draft: false,
    maintainer_can_modify: true,
  };
  pending.normalizedArguments = normalizedArguments;
  const provenance = pending.provenance;
  assert.ok(provenance);
  const binding = provenance.binding;
  assert.ok(binding);
  provenance.actionDigest = digestCanonical(normalizedArguments);
  const operation = state.operations.find((candidate) => candidate.id === "operation-live-pr");
  assert.ok(operation);
  operation.normalizedArguments = normalizedArguments;
  operation.argumentDigest = provenance.actionDigest;
  state.externalAction = {
    type: "pull_request",
    idempotencyKey: "prepared-live-pr",
    operationId: "operation-live-pr",
    replayPolicy: "RECONCILE_FIRST",
    preparedArguments: {
      repository: state.task.repository,
      base: "determination",
      head: "fix/demo",
      title: "docs: record live proof",
      body: "Documentation-only external-write proof.",
      expectedHeadSha: "abcdef1234567890",
    },
    binding,
    status: "PREPARED",
  };

  assert.equal(provenance.actionDigest, digestCanonical(pending.normalizedArguments));
  assert.equal(digestCanonical(state.approvals[0]?.normalizedArguments), provenance.actionDigest);
  assert.equal(operation.actionType, pending.action);
  assert.equal(operation.repository, provenance.repository);
  assert.equal(operation.revision, provenance.revision);
  assert.ok(artifactBindingMatchesState(binding, state, "EXTERNAL"));
  assert.doesNotThrow(() =>
    validateCreatePullRequestCall(pending.normalizedArguments, {
      ...state.externalAction!.preparedArguments,
      operationId: state.externalAction!.operationId,
      idempotencyKey: state.externalAction!.idempotencyKey,
    })
  );

  assert.doesNotThrow(() => assertLiveApprovalReady(state, pending, evidence));
});

test("live PR approval is blocked while any required criterion is not PASS", () => {
  const { state, evidence, pending } = readyState();
  const criterion = state.successCriteria.find((item) => item.id === "tests");
  assert.ok(criterion);
  criterion.status = "FAIL";

  assert.throws(
    () => assertLiveApprovalReady(state, pending, evidence),
    /tests: status FAIL/,
  );
});

test("live PR approval is blocked when a verifier never ran", () => {
  const { state, evidence, pending } = readyState();
  state.verifierResults = state.verifierResults.filter((result) => result.criterionId !== "tests");

  assert.throws(
    () => assertLiveApprovalReady(state, pending, evidence),
    /tests: verifier never ran/,
  );
});

test("live PR approval requires verifier-linked admissible evidence", () => {
  const { state, evidence, pending } = readyState();
  const result = state.verifierResults.find((item) => item.criterionId === "tests");
  assert.ok(result);
  result.evidenceIds = ["evidence-review"];

  assert.throws(
    () => assertLiveApprovalReady(state, pending, evidence),
    /tests: latest PASS has no criterion-linked evidence/,
  );
});

test("live publishing rejects non-PR external writes in P0", () => {
  const { state, evidence, pending } = readyState();
  assert.throws(
    () =>
      assertLiveApprovalReady(
        state,
        { ...pending, action: "github.create_comment" },
        evidence,
      ),
    /supports only pull-request creation/,
  );
});

test("privileged live approvals remain denied by the P0 policy", () => {
  const { state, evidence, pending } = readyState();
  assert.throws(
    () =>
      assertLiveApprovalReady(
        state,
        {
          ...pending,
          action: "github.read_secret",
          risk: "PRIVILEGED",
          reversible: false,
        },
        evidence,
      ),
    /denied by the P0 policy/,
  );
});

test("read-only TrueForge approvals do not require patch completion", () => {
  const state = buildState();
  const readOnly = approval(state, {
    action: "github.get_repository",
    risk: "READ_ONLY",
    reversible: false,
  });
  assert.doesNotThrow(() =>
    assertLiveApprovalReady(state, readOnly, new EvidenceStore()),
  );
});
