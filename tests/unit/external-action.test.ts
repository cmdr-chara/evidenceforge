import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeEvent } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { ExternalActionCoordinator } from "../../packages/policies/src";
import { artifactBindingFor } from "../../packages/verification/src";
import { buildState } from "../fixtures/builders";

function prepare(coordinator: ExternalActionCoordinator) {
  const state = buildState();
  state.task.repository = "cmdr-chara/evidenceforge";
  state.patchDigest = "f".repeat(64);
  return {
    state,
    ...coordinator.preparePullRequest({
      sessionId: "session-1",
      repository: state.task.repository,
      base: "determination",
      head: "fix/demo",
      title: "fix: config order",
      body: "Evidence-backed remediation",
      expectedHeadSha: state.task.revision,
      patchDigest: state.patchDigest,
      binding: artifactBindingFor(state, "EXTERNAL"),
    }),
  };
}

test("external PR cannot commit before approval", () => {
  const coordinator = new ExternalActionCoordinator();
  const { action } = prepare(coordinator);
  assert.throws(() => coordinator.markCommitted(action));
});

test("reconciliation rejects actions that were not committed after approval", () => {
  const coordinator = new ExternalActionCoordinator();
  const prepared = prepare(coordinator);
  const event: RuntimeEvent = {
    id: "reconcile-before-commit",
    type: "EXTERNAL_RECONCILIATION",
    source: "github-mcp",
    timestamp: new Date().toISOString(),
    payload: {},
  };
  const identity = {
    identifier: "#219",
    repository: prepared.action.preparedArguments.repository,
    base: prepared.action.preparedArguments.base,
    head: prepared.action.preparedArguments.head,
    headSha: prepared.action.preparedArguments.expectedHeadSha,
    operationId: prepared.action.operationId,
    idempotencyKey: prepared.action.idempotencyKey,
  };

  for (const status of ["PREPARED", "APPROVED", "DENIED"] as const) {
    assert.throws(
      () =>
        coordinator.reconcile(
          { ...prepared.state, externalAction: { ...prepared.action, status } },
          event,
          identity,
        ),
      /committed approved action/,
    );
  }
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

test("external result reconciliation records exact PR evidence", () => {
  const store = new EvidenceStore();
  const coordinator = new ExternalActionCoordinator(undefined, store);
  const prepared = prepare(coordinator);
  prepared.approval.status = "APPROVED";
  const committed = coordinator.markCommitted(
    coordinator.applyApproval(prepared.action, prepared.approval),
  );
  prepared.state.externalAction = committed;
  const event: RuntimeEvent = {
    id: "reconcile-1",
    type: "EXTERNAL_RECONCILIATION",
    source: "github-mcp",
    timestamp: new Date().toISOString(),
    payload: {},
  };
  store.recordEvent(event);
  const reconciled = coordinator.reconcile(prepared.state, event, {
    identifier: "#219",
    repository: committed.preparedArguments.repository,
    base: committed.preparedArguments.base,
    head: committed.preparedArguments.head,
    headSha: committed.preparedArguments.expectedHeadSha,
    operationId: committed.operationId,
    idempotencyKey: committed.idempotencyKey,
  });
  assert.equal(reconciled.status, "RECONCILED");
  assert.ok(reconciled.evidenceId);
  assert.ok(store.hasEvidence(reconciled.evidenceId));
});

test("identical reconciliation is idempotent and conflicting identifiers are rejected", () => {
  const store = new EvidenceStore();
  const coordinator = new ExternalActionCoordinator(undefined, store);
  const prepared = prepare(coordinator);
  prepared.approval.status = "APPROVED";
  const committed = coordinator.markCommitted(
    coordinator.applyApproval(prepared.action, prepared.approval),
  );
  prepared.state.externalAction = committed;
  const event: RuntimeEvent = {
    id: "reconcile-idempotent",
    type: "EXTERNAL_RECONCILIATION",
    source: "github-mcp",
    timestamp: new Date().toISOString(),
    payload: {},
  };
  store.recordEvent(event);
  const identity = {
    identifier: "#219",
    repository: committed.preparedArguments.repository,
    base: committed.preparedArguments.base,
    head: committed.preparedArguments.head,
    headSha: committed.preparedArguments.expectedHeadSha,
    operationId: committed.operationId,
    idempotencyKey: committed.idempotencyKey,
  };

  const reconciled = coordinator.reconcile(prepared.state, event, identity);
  const replay = coordinator.reconcile(
    { ...prepared.state, externalAction: reconciled },
    event,
    identity,
  );

  assert.deepEqual(replay, reconciled);
  assert.equal(store.listEvidence().length, 1);
  assert.throws(
    () =>
      coordinator.reconcile(
        { ...prepared.state, externalAction: reconciled },
        event,
        { ...identity, identifier: "#220" },
      ),
    /conflicts with the existing result/,
  );
});

test("same commit on a different PR target is rejected", () => {
  const store = new EvidenceStore();
  const coordinator = new ExternalActionCoordinator(undefined, store);
  const prepared = prepare(coordinator);
  prepared.approval.status = "APPROVED";
  prepared.state.externalAction = coordinator.markCommitted(
    coordinator.applyApproval(prepared.action, prepared.approval),
  );
  const event: RuntimeEvent = {
    id: "reconcile-wrong-pr",
    type: "EXTERNAL_RECONCILIATION",
    source: "github-mcp",
    timestamp: new Date().toISOString(),
    payload: {},
  };
  store.recordEvent(event);
  assert.throws(
    () =>
      coordinator.reconcile(prepared.state, event, {
        identifier: "#999",
        repository: prepared.state.task.repository,
        base: "other-base",
        head: "fix/demo",
        headSha: prepared.state.task.revision,
        operationId: prepared.state.externalAction!.operationId,
        idempotencyKey: prepared.state.externalAction!.idempotencyKey,
      }),
    /exact prepared identity/,
  );
});

test("idempotency key is stable for session, patch, and action", () => {
  const coordinator = new ExternalActionCoordinator();
  assert.equal(prepare(coordinator).action.idempotencyKey, prepare(coordinator).action.idempotencyKey);
});
