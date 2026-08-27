import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSessionState,
  createTask,
} from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { ExternalActionCoordinator } from "../../packages/policies/src";
import { artifactBindingFor } from "../../packages/verification/src";
import {
  buildCiSuccessContract,
  createOperationIntent,
  SessionController,
} from "../../packages/workflow/src";
import { passCriterion } from "../fixtures/builders";

function ciState() {
  const task = createTask({
    id: "task-repatch",
    objective: "Resolve CI failure",
    repository: "cmdr-chara/evidenceforge",
    revision: "abc123",
    runId: "842",
    createdAt: "2026-08-27T12:20:00.000Z",
  });
  const state = createSessionState(task, buildCiSuccessContract(task));
  state.patchDigest = "a".repeat(64);
  return state;
}

test("repatch preserves incident-context and root-cause evidence", () => {
  const state = ciState();
  const store = new EvidenceStore();
  passCriterion(state, store, "incident-context");
  passCriterion(state, store, "failure-reproduced");
  passCriterion(state, store, "root-cause-supported");
  passCriterion(state, store, "targeted-tests");

  const updated = new SessionController(state).setPatchDigest("b".repeat(64));

  for (const id of ["incident-context", "failure-reproduced", "root-cause-supported"]) {
    const criterion = updated.successCriteria.find((candidate) => candidate.id === id);
    assert.equal(criterion?.status, "PASS", id);
    assert.equal(criterion?.evidenceIds.length, 1, id);
  }
  assert.equal(
    updated.successCriteria.find((candidate) => candidate.id === "targeted-tests")?.status,
    "PENDING",
  );
});

test("repatch removes external action approval and operation bound to old patch", () => {
  const state = ciState();
  const coordinator = new ExternalActionCoordinator();
  const prepared = coordinator.preparePullRequest({
    sessionId: state.traceId,
    repository: state.task.repository,
    base: "determination",
    head: "feat/foundation-control-plane",
    title: "fix: verified patch",
    body: "verified",
    expectedHeadSha: state.task.revision,
    patchDigest: state.patchDigest as string,
    binding: artifactBindingFor(state, "EXTERNAL"),
  });
  state.externalAction = prepared.action;
  state.approvals.push(prepared.approval);
  state.operations.push(
    createOperationIntent({
      id: prepared.action.operationId,
      actionType: prepared.approval.action,
      tool: prepared.approval.action,
      normalizedArguments: prepared.approval.normalizedArguments,
      repository: state.task.repository,
      revision: state.task.revision,
      risk: "EXTERNAL_REVERSIBLE",
      replayPolicy: "RECONCILE_FIRST",
      expectedEvidence: ["pull request"],
      idempotencyKey: prepared.action.idempotencyKey,
    }),
  );

  const updated = new SessionController(state).setPatchDigest("c".repeat(64));

  assert.equal(updated.externalAction, undefined);
  assert.equal(updated.approvals.some((approval) => approval.id === prepared.approval.id), false);
  assert.equal(updated.operations.some((operation) => operation.id === prepared.action.operationId), false);
});
