import assert from "node:assert/strict";
import { test } from "node:test";
import { ExternalActionCoordinator } from "../../packages/policies/src";

function prepare() {
  const coordinator = new ExternalActionCoordinator();
  return {
    coordinator,
    ...coordinator.preparePullRequest({
      sessionId: "session-binding",
      repository: "cmdr-chara/evidenceforge",
      base: "determination",
      head: "fix/demo",
      title: "fix: config order",
      body: "Evidence-backed remediation",
      expectedHeadSha: "abc123",
      patchDigest: "f".repeat(64),
    }),
  };
}

test("approval arguments are an independent snapshot of the prepared action", () => {
  const { coordinator, action, approval } = prepare();
  const argumentsSnapshot = approval.normalizedArguments as Record<string, string>;
  argumentsSnapshot.head = "attacker/replacement";

  assert.equal(action.preparedArguments.head, "fix/demo");
  approval.status = "APPROVED";
  assert.throws(
    () => coordinator.applyApproval(action, approval),
    /arguments do not match/,
  );
});

test("an unrelated approval cannot authorize pull-request creation", () => {
  const { coordinator, action, approval } = prepare();
  approval.action = "github.get_repository";
  approval.risk = "READ_ONLY";
  approval.status = "APPROVED";

  assert.throws(
    () => coordinator.applyApproval(action, approval),
    /does not authorize pull-request creation/,
  );
});

test("an approval cannot be replayed after the action leaves PREPARED", () => {
  const { coordinator, action, approval } = prepare();
  approval.status = "APPROVED";
  const approved = coordinator.applyApproval(action, approval);
  assert.equal(approved.status, "APPROVED");

  assert.throws(
    () => coordinator.applyApproval(approved, approval),
    /only be applied to a PREPARED action/,
  );
});
