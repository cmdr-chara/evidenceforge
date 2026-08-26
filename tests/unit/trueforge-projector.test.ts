import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeEvent } from "../../packages/domain/src";
import { TrueForgeEventProjector } from "../../packages/trueforge/src";
import { buildState } from "../fixtures/builders";

function event(type: RuntimeEvent["type"], id: string, payload: unknown): RuntimeEvent {
  return {
    id,
    type,
    source: "trueforge:test",
    threadId: "main",
    timestamp: "2026-08-25T19:30:00.000Z",
    payload,
  };
}

function modelToolCall(
  callId: string,
  name: string,
  argumentsJson: string,
  serverName = "github",
): RuntimeEvent {
  return event("MODEL_MESSAGE", `message-${callId}`, {
    type: "model.message",
    id: `message-${callId}`,
    threadId: "main",
    toolCalls: [
      {
        id: callId,
        type: "function",
        function: { name, arguments: argumentsJson },
        toolInfo: { type: "mcp", serverName, name },
      },
    ],
  });
}

test("TrueForge PR approval is projected with trusted risk and exact arguments", () => {
  const state = buildState();
  state.phase = "REVIEWING";
  const projector = new TrueForgeEventProjector();
  projector.project(
    state,
    modelToolCall(
      "call-pr",
      "create_pull_request",
      JSON.stringify({ owner: "cmdr-chara", repo: "evidenceforge", head: "fix/demo" }),
    ),
  );
  const projection = projector.project(
    state,
    event("APPROVAL", "approval-event", {
      type: "tool.approval_required",
      id: "approval-event",
      threadId: "main",
      toolCalls: [{ id: "call-pr", sourceEventId: "message-call-pr" }],
    }),
  );

  assert.deepEqual(projection.approvalIds, ["approval-approval-event-call-pr"]);
  assert.equal(state.phase, "AWAITING_APPROVAL");
  assert.equal(state.approvals[0]?.action, "github.create_pull_request");
  assert.equal(state.approvals[0]?.risk, "EXTERNAL_REVERSIBLE");
  assert.equal(state.approvals[0]?.status, "PENDING");
  assert.deepEqual(state.approvals[0]?.normalizedArguments, {
    owner: "cmdr-chara",
    repo: "evidenceforge",
    head: "fix/demo",
  });
});

test("privileged TrueForge approval is denied by policy and blocks the session", () => {
  const state = buildState();
  const projector = new TrueForgeEventProjector();
  projector.project(state, modelToolCall("call-secret", "read_secret", "{}"));
  projector.project(
    state,
    event("APPROVAL", "approval-secret", {
      type: "tool.approval_required",
      id: "approval-secret",
      threadId: "main",
      toolCalls: [{ id: "call-secret" }],
    }),
  );

  assert.equal(state.approvals[0]?.risk, "PRIVILEGED");
  assert.equal(state.approvals[0]?.status, "DENIED");
  assert.equal(state.phase, "BLOCKED");
  assert.equal(state.status, "BLOCKED");
});

test("uncorrelated approval fails closed", () => {
  const state = buildState();
  const projection = new TrueForgeEventProjector().project(
    state,
    event("APPROVAL", "approval-orphan", {
      type: "tool.approval_required",
      id: "approval-orphan",
      threadId: "main",
      toolCalls: [{ id: "missing-call" }],
    }),
  );

  assert.match(projection.error ?? "", /unknown call/);
  assert.equal(state.phase, "BLOCKED");
  assert.equal(state.approvals.length, 0);
});

test("malformed tool response projects a deterministic error result", () => {
  const state = buildState();
  const projector = new TrueForgeEventProjector();
  projector.project(state, modelToolCall("call-command", "run_command", "{}", "daytona"));
  const projection = projector.project(
    state,
    event("TOOL_RESULT", "response-command", {
      type: "tool.response",
      id: "response-command",
      threadId: "main",
      toolCallId: "call-command",
      content: "not structured JSON",
    }),
  );

  assert.equal(projection.toolResult?.status, "ERROR");
  assert.equal(projection.toolResult?.errorCode, "MALFORMED_TOOL_RESPONSE");
  assert.equal(state.status, "ACTIVE");
});

test("turn creation enters DEFINE_SUCCESS but cannot skip to a terminal phase", () => {
  const state = buildState();
  new TrueForgeEventProjector().project(
    state,
    event("TURN_CREATED", "turn-created", { type: "turn.created", id: "turn-created" }),
  );
  assert.equal(state.phase, "DEFINE_SUCCESS");
  assert.equal(state.status, "ACTIVE");
});

test("cancelled TrueForge turn blocks the workflow with a bounded reason", () => {
  const state = buildState();
  const projection = new TrueForgeEventProjector().project(
    state,
    event("TURN_DONE", "turn-timeout", {
      type: "turn.done",
      id: "turn-timeout",
      state: {
        status: "cancelled",
        reason: "server-execution-timeout",
      },
    }),
  );

  assert.deepEqual(projection.approvalIds, []);
  assert.equal(state.phase, "BLOCKED");
  assert.equal(state.status, "BLOCKED");
  assert.equal(state.blockedReason, "TrueForge turn exceeded the server execution timeout");
});
