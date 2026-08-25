import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeEvent } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { ExternalActionCoordinator } from "../../packages/policies/src";
import { buildState } from "../fixtures/builders";

function prepare(coordinator: ExternalActionCoordinator) {
  return coordinator.preparePullRequest({
    sessionId: "session-1",
    repository: "cmdr-chara/evidenceforge",
    base: "determination",
    head: "fix/demo",
    title: "fix: config order",
    body: "Evidence-backed remediation",
    expectedHeadSha: "abc123",
    patchDigest: "f".repeat(64),
  });
}

test("external PR cannot commit before approval", () => {
  const coordinator = new ExternalActionCoordinator();
  const { action } = prepare(coordinator);
  assert.throws(() => coordinator.markCommitted(action));
});

test("approval denial is represented and respected", () => {
  const coordinator = new ExternalActionCoordinator();
  const { action, approval } = prepare(coordinator);
  approval.status = "DENIED";
  const denied = coordinator.applyApproval(action, approval);
  assert.equal(denied.status, "DENIED");
});

test("PR request timeout path requires reconciliation before retry", () => {
  const coordinator = new ExternalActionCoordinator();
  const { action, approval } = prepare(coordinator);
  approval.status = "APPROVED";
  const approved = coordinator.applyApproval(action, approval);
  assert.equal(coordinator.mustReconcileBeforeRetry(approved), true);
});

test("external result reconciliation records evidence", () => {
  const store = new EvidenceStore();
  const coordinator = new ExternalActionCoordinator(undefined, store);
  const { action, approval } = prepare(coordinator);
  approval.status = "APPROVED";
  const committed = coordinator.markCommitted(coordinator.applyApproval(action, approval));
  const state = buildState();
  state.externalAction = committed;
  const event: RuntimeEvent = {
    id: "reconcile-1",
    type: "EXTERNAL_RECONCILIATION",
    source: "github-mcp",
    timestamp: new Date().toISOString(),
    payload: {},
  };
  store.recordEvent(event);
  const reconciled = coordinator.reconcile(state, event, "#219", "abc123");
  assert.equal(reconciled.status, "RECONCILED");
  assert.ok(reconciled.evidenceId);
  assert.ok(store.hasEvidence(reconciled.evidenceId));
});

test("idempotency key is stable for session and patch", () => {
  const coordinator = new ExternalActionCoordinator();
  assert.equal(prepare(coordinator).action.idempotencyKey, prepare(coordinator).action.idempotencyKey);
});
