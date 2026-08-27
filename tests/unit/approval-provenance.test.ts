import assert from "node:assert/strict";
import test from "node:test";
import { ExternalActionCoordinator } from "../../packages/policies/src";
import { artifactBindingFor } from "../../packages/verification/src";
import { buildState } from "../fixtures/builders";

function prepared() {
  const state = buildState();
  state.task.repository = "owner/repository";
  state.patchDigest = "a".repeat(64);
  return new ExternalActionCoordinator().preparePullRequest({
    sessionId: "session-approval",
    repository: state.task.repository,
    base: "main",
    head: "fix/demo",
    title: "Fix demo",
    body: "Verified fix",
    expectedHeadSha: state.task.revision,
    patchDigest: state.patchDigest,
    binding: artifactBindingFor(state, "EXTERNAL"),
    now: "2026-08-25T18:00:00.000Z",
  });
}

test("approval is bound to action digest, repository, revision, risk, and operation", () => {
  const { action, approval } = prepared();
  approval.status = "APPROVED";
  approval.provenance!.revision = "substituted";
  assert.throws(
    () => new ExternalActionCoordinator().applyApproval(action, approval, "2026-08-25T18:01:00.000Z"),
    /provenance/,
  );
});

test("approval expires and can be consumed only once", () => {
  const expired = prepared();
  expired.approval.status = "APPROVED";
  assert.throws(
    () =>
      new ExternalActionCoordinator().applyApproval(
        expired.action,
        expired.approval,
        "2026-08-25T18:16:00.000Z",
      ),
    /expired/,
  );

  const oneShot = prepared();
  oneShot.approval.status = "APPROVED";
  new ExternalActionCoordinator().applyApproval(
    oneShot.action,
    oneShot.approval,
    "2026-08-25T18:01:00.000Z",
  );
  assert.throws(
    () =>
      new ExternalActionCoordinator().applyApproval(
        oneShot.action,
        oneShot.approval,
        "2026-08-25T18:02:00.000Z",
      ),
    /consumed/,
  );
});

test("malformed approval expiry fails closed", () => {
  const malformed = prepared();
  malformed.approval.status = "APPROVED";
  malformed.approval.provenance!.expiresAt = "not-a-timestamp";
  assert.throws(
    () =>
      new ExternalActionCoordinator().applyApproval(
        malformed.action,
        malformed.approval,
        "2026-08-25T18:01:00.000Z",
      ),
    /malformed timestamps/,
  );

  const inverted = prepared();
  inverted.approval.status = "APPROVED";
  inverted.approval.provenance!.expiresAt = "2026-08-25T17:59:00.000Z";
  assert.throws(
    () =>
      new ExternalActionCoordinator().applyApproval(
        inverted.action,
        inverted.approval,
        "2026-08-25T18:01:00.000Z",
      ),
    /expiry is malformed/,
  );
});
