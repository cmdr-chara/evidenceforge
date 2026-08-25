import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLiveApprovalReady } from "../../apps/server/src/live-service";
import { ApprovalRequest } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { buildState, passAll } from "../fixtures/builders";

function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "approval-live-pr",
    action: "github.create_pull_request",
    normalizedArguments: {
      owner: "cmdr-chara",
      repo: "evidenceforge",
      base: "determination",
      head: "fix/demo",
    },
    risk: "EXTERNAL_REVERSIBLE",
    reason: "external write",
    reversible: true,
    status: "PENDING",
    toolCallId: "call-pr",
    threadId: "main",
    ...overrides,
  };
}

function readyState() {
  const state = buildState();
  const evidence = new EvidenceStore();
  passAll(state, evidence);
  state.phase = "AWAITING_APPROVAL";
  return { state, evidence };
}

test("live PR approval requires verified pre-publish state", () => {
  const { state, evidence } = readyState();
  assert.doesNotThrow(() => assertLiveApprovalReady(state, approval(), evidence));
});

test("live PR approval is blocked while any required criterion is not PASS", () => {
  const { state, evidence } = readyState();
  const criterion = state.successCriteria.find((item) => item.id === "tests");
  assert.ok(criterion);
  criterion.status = "FAIL";

  assert.throws(
    () => assertLiveApprovalReady(state, approval(), evidence),
    /tests: status FAIL/,
  );
});

test("live PR approval is blocked when a verifier never ran", () => {
  const { state, evidence } = readyState();
  state.verifierResults = state.verifierResults.filter((result) => result.criterionId !== "tests");

  assert.throws(
    () => assertLiveApprovalReady(state, approval(), evidence),
    /tests: verifier never ran/,
  );
});

test("live PR approval requires verifier-linked admissible evidence", () => {
  const { state, evidence } = readyState();
  const result = state.verifierResults.find((item) => item.criterionId === "tests");
  assert.ok(result);
  result.evidenceIds = ["evidence-review"];

  assert.throws(
    () => assertLiveApprovalReady(state, approval(), evidence),
    /tests: latest PASS has no criterion-linked evidence/,
  );
});

test("live publishing rejects non-PR external writes in P0", () => {
  const { state, evidence } = readyState();
  assert.throws(
    () =>
      assertLiveApprovalReady(
        state,
        approval({ action: "github.create_comment" }),
        evidence,
      ),
    /supports only pull-request creation/,
  );
});

test("privileged live approvals remain denied by the P0 policy", () => {
  const { state, evidence } = readyState();
  assert.throws(
    () =>
      assertLiveApprovalReady(
        state,
        approval({
          action: "github.read_secret",
          risk: "PRIVILEGED",
          reversible: false,
        }),
        evidence,
      ),
    /denied by the P0 policy/,
  );
});

test("read-only TrueForge approvals do not require patch completion", () => {
  const state = buildState();
  assert.doesNotThrow(() =>
    assertLiveApprovalReady(
      state,
      approval({
        action: "github.get_repository",
        risk: "READ_ONLY",
        reversible: false,
      }),
      new EvidenceStore(),
    ),
  );
});
