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
  passAll(state, new EvidenceStore());
  state.phase = "AWAITING_APPROVAL";
  return state;
}

test("live PR approval requires verified pre-publish state", () => {
  assert.doesNotThrow(() => assertLiveApprovalReady(readyState(), approval()));
});

test("live PR approval is blocked while any required criterion is not PASS", () => {
  const state = readyState();
  const criterion = state.successCriteria.find((item) => item.id === "tests");
  assert.ok(criterion);
  criterion.status = "FAIL";

  assert.throws(
    () => assertLiveApprovalReady(state, approval()),
    /blocked by criteria: tests/,
  );
});

test("live publishing rejects non-PR external writes in P0", () => {
  assert.throws(
    () =>
      assertLiveApprovalReady(
        readyState(),
        approval({ action: "github.create_comment" }),
      ),
    /supports only pull-request creation/,
  );
});

test("privileged live approvals remain denied by the P0 policy", () => {
  assert.throws(
    () =>
      assertLiveApprovalReady(
        readyState(),
        approval({
          action: "github.read_secret",
          risk: "PRIVILEGED",
          reversible: false,
        }),
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
    ),
  );
});
