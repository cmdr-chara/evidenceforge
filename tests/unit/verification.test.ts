import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingCriterion, RuntimeEvent, ToolResult } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { VerificationCorrelationError, VerificationEngine } from "../../packages/verification/src";

function event(id = "event-1"): RuntimeEvent {
  return {
    id,
    type: "TOOL_RESULT",
    source: "trueforge:tool.result",
    timestamp: new Date().toISOString(),
    payload: {},
  };
}

function result(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    callId: "call-1",
    eventId: "event-1",
    tool: "daytona.run_command",
    status: "OK",
    retryable: false,
    artifactRefs: [],
    evidenceIds: [],
    durationMs: 20,
    exitCode: 0,
    stdoutPreview: "pass",
    ...overrides,
  };
}

test("timeout becomes deterministic ToolResult failure", () => {
  const store = new EvidenceStore();
  const runtimeEvent = event();
  store.recordEvent(runtimeEvent);
  const criterion = pendingCriterion("tests", "tests pass", {
    kind: "COMMAND",
    argv: ["pnpm", "test"],
    cwd: "/workspace/repository",
    expectedExitCode: 0,
    timeoutSeconds: 60,
    purpose: "VERIFICATION",
  });
  const evaluation = new VerificationEngine(store).evaluateToolResult(
    criterion,
    runtimeEvent,
    result({ status: "TIMEOUT", exitCode: undefined, durationMs: 60_000 }),
  );
  assert.equal(evaluation.result.status, "FAIL");
  assert.equal(evaluation.result.deterministic, true);
});

test("failure reproduction requires non-zero exit and matching signature", () => {
  const store = new EvidenceStore();
  const runtimeEvent = event();
  store.recordEvent(runtimeEvent);
  const criterion = pendingCriterion("repro", "reproduce", {
    kind: "FAILURE_SIGNATURE",
    argv: ["pnpm", "test"],
    cwd: "/workspace/repository",
    expectedNonZeroExit: true,
    signature: "CONFIG_VALIDATION_ORDER",
    timeoutSeconds: 60,
  });
  const evaluation = new VerificationEngine(store).evaluateToolResult(
    criterion,
    runtimeEvent,
    result({ exitCode: 1, stderrPreview: "Error CONFIG_VALIDATION_ORDER" }),
  );
  assert.equal(evaluation.result.status, "PASS");
  assert.equal(evaluation.evidence.kind, "REPRODUCTION");
});

test("verification rejects mismatched runtime event", () => {
  const store = new EvidenceStore();
  const runtimeEvent = event();
  store.recordEvent(runtimeEvent);
  const criterion = pendingCriterion("tests", "tests pass", {
    kind: "COMMAND",
    argv: ["pnpm", "test"],
    cwd: "/workspace/repository",
    expectedExitCode: 0,
    timeoutSeconds: 60,
    purpose: "VERIFICATION",
  });
  assert.throws(
    () =>
      new VerificationEngine(store).evaluateToolResult(
        criterion,
        runtimeEvent,
        result({ eventId: "different" }),
      ),
    VerificationCorrelationError,
  );
});
