import assert from "node:assert/strict";
import test from "node:test";
import { ExternalActionCoordinator } from "../../packages/policies/src";

function prepared() {
  return new ExternalActionCoordinator().preparePullRequest({
    sessionId: "session-approval",
    repository: "owner/repository",
    base: "main",
    head: "fix/demo",
    title: "Fix demo",
    body: "Verified fix",
    expectedHeadSha: "abc123",
    patchDigest: "a".repeat(64),
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
