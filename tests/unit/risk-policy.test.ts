import assert from "node:assert/strict";
import { test } from "node:test";
import { ApprovalPolicy, RiskPolicy } from "../../packages/policies/src";

const policy = new RiskPolicy();

test("READ_ONLY does not require approval", () => {
  const decision = policy.classify({ tool: "github.get_workflow_run", arguments: {} });
  assert.equal(decision.risk, "READ_ONLY");
  assert.equal(decision.requiresApproval, false);
});

test("SANDBOX_MUTATION follows automatic sandbox policy", () => {
  const decision = policy.classify({ tool: "daytona.run_command", arguments: {} });
  assert.equal(decision.risk, "SANDBOX_MUTATION");
  assert.equal(decision.requiresApproval, false);
});

test("EXTERNAL_REVERSIBLE requires approval", () => {
  const decision = policy.classify({ tool: "github.create_pull_request", arguments: {} });
  assert.equal(decision.risk, "EXTERNAL_REVERSIBLE");
  assert.equal(decision.requiresApproval, true);
});

test("UNKNOWN requires approval even when annotation claims read-only", () => {
  const decision = policy.classify({
    tool: "mystery.execute",
    arguments: {},
    mcpAnnotations: { readOnlyHint: true, destructiveHint: false },
  });
  assert.equal(decision.risk, "UNKNOWN");
  assert.equal(decision.requiresApproval, true);
  assert.equal(decision.annotationsObserved, true);
});

test("denied approval blocks publishing", () => {
  const outcome = new ApprovalPolicy().authorize({
    id: "approval-1",
    action: "github.create_pull_request",
    normalizedArguments: {},
    risk: "EXTERNAL_REVERSIBLE",
    reason: "external write",
    reversible: true,
    status: "DENIED",
  });
  assert.equal(outcome.allowed, false);
});
