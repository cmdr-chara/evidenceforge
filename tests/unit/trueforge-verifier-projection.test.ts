import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createSessionState,
  createTask,
  RuntimeEvent,
  SessionState,
} from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import {
  buildVerifierManifest,
  TrueForgeEventProjector,
} from "../../packages/trueforge/src";
import { buildCiSuccessContract } from "../../packages/workflow/src";

interface Harness {
  state: SessionState;
  store: EvidenceStore;
  projector: TrueForgeEventProjector;
}

function createHarness(): Harness {
  const task = createTask({
    id: "task-verifier-projection",
    objective: "Resolve the deterministic CI failure",
    repository: "cmdr-chara/evidenceforge",
    revision: "abc123",
    runId: "842",
    createdAt: "2026-08-25T19:50:00.000Z",
  });
  const state = createSessionState(task, buildCiSuccessContract(task));
  state.patchDigest = createHash("sha256").update("verifier-patch").digest("hex");
  const store = new EvidenceStore();
  return {
    state,
    store,
    projector: new TrueForgeEventProjector(undefined, store),
  };
}

function modelToolCall(
  callId: string,
  criterionId: string,
  command: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): RuntimeEvent {
  const args: Record<string, unknown> = {
    intent: `evidenceforge.verify:${criterionId}`,
    command,
    cwd: options.cwd ?? "/workspace/repository",
  };
  if (options.env !== undefined) args.env = options.env;
  return {
    id: `message-${callId}`,
    type: "MODEL_MESSAGE",
    source: "trueforge:model.message",
    threadId: "main",
    timestamp: "2026-08-25T19:50:01.000Z",
    payload: {
      type: "model.message",
      id: `message-${callId}`,
      thread_id: "main",
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: { name: "exec", arguments: JSON.stringify(args) },
          tool_info: { type: "truefoundry-system", name: "sandbox" },
        },
      ],
    },
  };
}

function toolResponse(
  callId: string,
  exitCode: number,
  result: string,
): RuntimeEvent {
  return {
    id: `response-${callId}`,
    type: "TOOL_RESULT",
    source: "trueforge:tool.response",
    threadId: "main",
    timestamp: "2026-08-25T19:50:02.000Z",
    payload: {
      type: "tool.response",
      id: `response-${callId}`,
      thread_id: "main",
      tool_call_id: callId,
      content: JSON.stringify({
        success: true,
        response: { exitCode, result },
      }),
    },
  };
}

function criterion(state: SessionState, id: string) {
  const item = state.successCriteria.find((candidate) => candidate.id === id);
  assert.ok(item, `missing criterion ${id}`);
  return item;
}

function projectToolResult(harness: Harness, event: RuntimeEvent) {
  harness.store.recordEvent(event);
  return harness.projector.project(harness.state, event);
}

test("official sandbox non-zero exit can prove the expected failure signature", () => {
  const harness = createHarness();
  harness.projector.project(
    harness.state,
    modelToolCall("call-reproduce", "failure-reproduced", "pnpm test"),
  );
  const projection = projectToolResult(
    harness,
    toolResponse("call-reproduce", 1, "Error: CONFIG_VALIDATION_ORDER"),
  );

  assert.equal(projection.toolResult?.status, "OK");
  assert.equal(projection.verificationResult?.status, "PASS");
  assert.equal(criterion(harness.state, "failure-reproduced").status, "PASS");
  assert.equal(harness.state.verifierResults.length, 1);
  const evidenceId = harness.state.verifierResults[0]?.evidenceIds[0];
  assert.ok(evidenceId);
  const evidence = harness.store.getEvidence(evidenceId);
  assert.equal(evidence?.kind, "REPRODUCTION");
  assert.equal(evidence?.metadata?.callId, "call-reproduce");
});

test("altered command cannot update a success criterion", () => {
  const harness = createHarness();
  harness.projector.project(
    harness.state,
    modelToolCall("call-altered", "targeted-tests", "pnpm test || true"),
  );
  const projection = projectToolResult(
    harness,
    toolResponse("call-altered", 0, "all tests passed"),
  );

  assert.match(projection.verifierRejection ?? "", /command mismatch/);
  assert.equal(criterion(harness.state, "targeted-tests").status, "PENDING");
  assert.equal(harness.state.verifierResults.length, 0);
  assert.equal(harness.store.listEvidence().length, 0);
});

test("environment overrides cannot satisfy an application verifier", () => {
  const harness = createHarness();
  harness.projector.project(
    harness.state,
    modelToolCall("call-env", "targeted-tests", "pnpm test", {
      env: { NODE_ENV: "test" },
    }),
  );
  const projection = projectToolResult(
    harness,
    toolResponse("call-env", 0, "all tests passed"),
  );

  assert.match(projection.verifierRejection ?? "", /cannot override verifier environment/);
  assert.equal(criterion(harness.state, "targeted-tests").status, "PENDING");
});

test("free-form model prose cannot mark deterministic checks PASS", () => {
  const harness = createHarness();
  harness.projector.project(harness.state, {
    id: "message-prose",
    type: "MODEL_MESSAGE",
    source: "trueforge:model.message",
    timestamp: "2026-08-25T19:50:03.000Z",
    payload: {
      type: "model.message",
      id: "message-prose",
      content: "I ran the tests and they passed.",
    },
  });

  assert.equal(criterion(harness.state, "targeted-tests").status, "PENDING");
  assert.equal(harness.state.verifierResults.length, 0);
  assert.equal(harness.store.listEvidence().length, 0);
});

test("ordinary command verifier deterministically fails on exit code one", () => {
  const harness = createHarness();
  harness.projector.project(
    harness.state,
    modelToolCall("call-tests", "targeted-tests", "pnpm test"),
  );
  const projection = projectToolResult(
    harness,
    toolResponse("call-tests", 1, "1 test failed"),
  );

  assert.equal(projection.toolResult?.status, "OK");
  assert.equal(projection.verificationResult?.status, "FAIL");
  assert.equal(criterion(harness.state, "targeted-tests").status, "FAIL");
  assert.match(projection.verificationResult?.details ?? "", /exited 1, expected 0/);
});

test("replayed correlated response does not duplicate evidence or verifier results", () => {
  const harness = createHarness();
  harness.projector.project(
    harness.state,
    modelToolCall("call-typecheck", "typecheck", "pnpm typecheck"),
  );
  const response = toolResponse("call-typecheck", 0, "typecheck complete");
  const first = projectToolResult(harness, response);
  const second = harness.projector.project(harness.state, response);

  assert.equal(first.verificationResult?.status, "PASS");
  assert.equal(second.verificationResult?.status, "PASS");
  assert.equal(harness.state.verifierResults.length, 1);
  assert.equal(harness.store.listEvidence().length, 1);
});

test("verifier manifest exposes only exact application-owned sandbox commands", () => {
  const harness = createHarness();
  const manifest = buildVerifierManifest(harness.state.successCriteria);
  const entries = new Map(manifest.map((entry) => [entry.criterionId, entry]));

  assert.equal(entries.get("failure-reproduced")?.command, "pnpm test");
  assert.equal(entries.get("regression")?.command, "pnpm test -- config");
  assert.equal(entries.get("diff-integrity")?.command, "git diff --check");
  assert.equal(entries.get("failure-reproduced")?.tool, "sandbox.exec");
  assert.equal(entries.has("incident-context"), false);
  assert.equal(entries.has("independent-review"), false);
  assert.equal(entries.has("external-pr"), false);
});
