import assert from "node:assert/strict";
import test from "node:test";
import { createOperationIntent, decideOperationRecovery } from "../../packages/workflow/src";
import { replayPolicyForRisk } from "../../packages/tools/src";

test("tool risk binds an explicit replay policy", () => {
  assert.equal(replayPolicyForRisk("READ_ONLY"), "SAFE");
  assert.equal(replayPolicyForRisk("EXTERNAL_REVERSIBLE"), "RECONCILE_FIRST");
  assert.equal(replayPolicyForRisk("SANDBOX_MUTATION"), "NEVER");
  assert.equal(replayPolicyForRisk("EXTERNAL_DESTRUCTIVE"), "NEVER");
});

test("uncertain recovery follows persisted replay policy without guessing", () => {
  const base = {
    actionType: "fixture.action",
    tool: "fixture.tool",
    normalizedArguments: { b: 2, a: 1 },
    repository: "owner/repository",
    revision: "abc123",
    risk: "READ_ONLY" as const,
    expectedEvidence: ["fixture-result"],
  };
  const safe = createOperationIntent({ ...base, replayPolicy: "SAFE" });
  safe.status = "EFFECT_UNCERTAIN";
  assert.equal(decideOperationRecovery(safe).action, "REPLAY");

  const reconcile = createOperationIntent({
    ...base,
    risk: "EXTERNAL_REVERSIBLE",
    replayPolicy: "RECONCILE_FIRST",
  });
  reconcile.status = "EFFECT_STARTED";
  assert.equal(decideOperationRecovery(reconcile).action, "RECONCILE");

  const never = createOperationIntent({
    ...base,
    risk: "SANDBOX_MUTATION",
    replayPolicy: "NEVER",
  });
  never.status = "EFFECT_UNCERTAIN";
  assert.equal(decideOperationRecovery(never).action, "BLOCK");
});

test("normalized arguments have a stable persisted digest", () => {
  const first = createOperationIntent({
    id: "operation-stable",
    actionType: "read",
    tool: "repository.read",
    normalizedArguments: { path: "src/a.ts", options: { z: false, a: true } },
    repository: "owner/repository",
    revision: "abc123",
    risk: "READ_ONLY",
    replayPolicy: "SAFE",
    expectedEvidence: ["content"],
  });
  const second = createOperationIntent({
    id: "operation-stable",
    actionType: "read",
    tool: "repository.read",
    normalizedArguments: { options: { a: true, z: false }, path: "src/a.ts" },
    repository: "owner/repository",
    revision: "abc123",
    risk: "READ_ONLY",
    replayPolicy: "SAFE",
    expectedEvidence: ["content"],
  });
  assert.equal(first.argumentDigest, second.argumentDigest);
});
