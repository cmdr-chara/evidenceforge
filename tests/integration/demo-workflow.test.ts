import assert from "node:assert/strict";
import { test } from "node:test";
import { DemoWorkflow } from "../../apps/server/src/demo-workflow";

test("deterministic demo traverses approval and issues a certificate", () => {
  const workflow = new DemoWorkflow();
  for (let index = 0; index < 8; index += 1) workflow.advance();
  let snapshot = workflow.snapshot();
  assert.equal(snapshot.phase, "AWAITING_APPROVAL");
  assert.equal(snapshot.approvals[0]?.status, "PENDING");
  snapshot = workflow.decideApproval("approval-demo-pr", "APPROVED");
  assert.equal(snapshot.phase, "PUBLISHING");
  snapshot = workflow.advance();
  assert.equal(snapshot.phase, "COMPLETED");
  assert.equal(snapshot.completionCertificate?.requiredCriteria.length, 10);
  assert.equal(snapshot.completionCertificate?.externalAction?.identifier, "#219");
});

test("denying the demo PR blocks publishing", () => {
  const workflow = new DemoWorkflow();
  for (let index = 0; index < 8; index += 1) workflow.advance();
  const snapshot = workflow.decideApproval("approval-demo-pr", "DENIED");
  assert.equal(snapshot.phase, "BLOCKED");
  assert.equal(snapshot.status, "BLOCKED");
  assert.equal(snapshot.completionCertificate, undefined);
});
