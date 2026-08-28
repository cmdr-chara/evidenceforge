import assert from "node:assert/strict";
import { test } from "node:test";
import { TrueForgeEventIndex } from "../../packages/trueforge/src";

function indexToolCall(callId = "call-1"): TrueForgeEventIndex {
  const index = new TrueForgeEventIndex();
  index.ingest({
    type: "model.message",
    id: "message-1",
    threadId: "main",
    toolCalls: [
      {
        id: callId,
        type: "function",
        function: { name: "run_command", arguments: '{"argv":["pnpm","test"]}' },
        toolInfo: { type: "mcp", serverName: "daytona", name: "run_command" },
      },
    ],
  });
  return index;
}

function indexSandboxExec(callId = "call-exec"): TrueForgeEventIndex {
  const index = new TrueForgeEventIndex();
  index.ingest({
    type: "model.message",
    id: "message-exec",
    thread_id: "main",
    tool_calls: [
      {
        id: callId,
        type: "function",
        function: {
          name: "exec",
          arguments: JSON.stringify({
            intent: "Run the deterministic test verifier",
            command: "pnpm test",
            cwd: "/workspace/repository",
          }),
        },
        tool_info: { type: "truefoundry-system", name: "sandbox" },
      },
    ],
  });
  return index;
}

test("TrueForge tool response correlates with the originating model tool call", () => {
  const index = indexToolCall();
  const result = index.toolResultFrom({
    type: "tool.response",
    id: "response-1",
    threadId: "main",
    toolCallId: "call-1",
    content: JSON.stringify({
      status: "OK",
      exitCode: 0,
      durationMs: 41,
      stdoutPreview: "pass",
      artifactRefs: ["artifact://stdout"],
    }),
  });
  assert.equal(result.eventId, "response-1");
  assert.equal(result.tool, "daytona.run_command");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.artifactRefs, ["artifact://stdout"]);
});

test("TrueForge call_tool envelope indexes the inner GitHub MCP identity", () => {
  const index = new TrueForgeEventIndex();
  index.ingest({
    type: "model.message",
    id: "message-call-tool",
    threadId: "main",
    toolCalls: [{
      id: "call-github",
      type: "function",
      function: {
        name: "call_tool",
        arguments: JSON.stringify({
          mcp_server: "github",
          tool_name: "get_commit",
          input: { owner: "cmdr-chara", repo: "evidenceforge", sha: "deadbeef" },
        }),
      },
      toolInfo: { type: "truefoundry-system", name: "call_tool" },
    }],
  });

  const call = index.getToolCall("call-github");
  assert.equal(call?.serverName, "github");
  assert.equal(call?.name, "get_commit");
  assert.deepEqual(JSON.parse(call?.arguments ?? "{}"), {
    owner: "cmdr-chara",
    repo: "evidenceforge",
    sha: "deadbeef",
  });
  const result = index.toolResultFrom({
    type: "tool.response",
    id: "response-call-tool",
    toolCallId: "call-github",
    content: JSON.stringify({ success: true, response: { sha: "deadbeef" } }),
  });
  assert.equal(result.tool, "github.get_commit");
});

test("malformed call_tool envelope cannot acquire an authoritative connector identity", () => {
  const index = new TrueForgeEventIndex();
  index.ingest({
    type: "model.message",
    id: "message-malformed-call-tool",
    threadId: "main",
    toolCalls: [{
      id: "call-malformed",
      type: "function",
      function: {
        name: "call_tool",
        arguments: JSON.stringify({
          mcp_server: "github",
          tool_name: "get_commit",
          input: "not-an-object",
        }),
      },
      toolInfo: { type: "truefoundry-system", name: "call_tool" },
    }],
  });

  const call = index.getToolCall("call-malformed");
  assert.equal(call?.name, "call_tool");
  assert.equal(call?.serverName, undefined);
});

test("streamed model-message deltas are merged before a tool response is correlated", () => {
  const index = new TrueForgeEventIndex();
  index.ingest({
    type: "model.message",
    id: "message-streamed",
    threadId: "main",
  });
  index.ingest({
    type: "model.message.delta",
    id: "message-streamed",
    toolCalls: [
      {
        index: 0,
        id: "call-streamed",
        function: { name: "exec", arguments: '{"command":"pnpm' },
        toolInfo: { type: "truefoundry-system", name: "sandbox" },
      },
    ],
  });
  index.ingest({
    type: "model.message.delta",
    id: "message-streamed",
    toolCalls: [{ index: 0, function: { arguments: ' test"}' } }],
    finishReason: "tool_calls",
  });

  const result = index.toolResultFrom({
    type: "tool.response",
    id: "response-streamed",
    threadId: "main",
    toolCallId: "call-streamed",
    content: JSON.stringify({
      success: true,
      response: { exitCode: 0, result: "tests passed" },
    }),
  });

  assert.equal(result.tool, "sandbox.exec");
  assert.equal(result.status, "OK");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutPreview, "tests passed");
});

test("authoritative TrueForge sandbox success decodes the nested command result", () => {
  const result = indexSandboxExec().toolResultFrom({
    type: "tool.response",
    id: "response-exec-pass",
    threadId: "main",
    toolCallId: "call-exec",
    content: JSON.stringify({
      success: true,
      response: { exitCode: 0, result: "83 tests passed" },
    }),
  });

  assert.equal(result.tool, "sandbox.exec");
  assert.equal(result.status, "OK");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutPreview, "83 tests passed");
  assert.equal(result.errorCode, undefined);
});

test("sandbox command exit is preserved separately from tool execution status", () => {
  const result = indexSandboxExec().toolResultFrom({
    type: "tool.response",
    id: "response-exec-fail",
    threadId: "main",
    toolCallId: "call-exec",
    content: JSON.stringify({
      success: true,
      response: { exitCode: 1, result: "CONFIG_VALIDATION_ORDER" },
    }),
  });

  assert.equal(result.status, "OK");
  assert.equal(result.retryable, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.errorCode, undefined);
  assert.match(result.stdoutPreview ?? "", /CONFIG_VALIDATION_ORDER/);
});

test("authoritative TrueForge sandbox infrastructure failure is explicit", () => {
  const result = indexSandboxExec().toolResultFrom({
    type: "tool.response",
    id: "response-exec-infra",
    threadId: "main",
    toolCallId: "call-exec",
    content: JSON.stringify({
      success: false,
      error: "temporary network timeout while contacting Daytona",
    }),
  });

  assert.equal(result.status, "ERROR");
  assert.equal(result.retryable, true);
  assert.equal(result.errorCode, "SANDBOX_INFRASTRUCTURE_ERROR");
  assert.match(result.stderrPreview ?? "", /Daytona/);
});

test("incomplete TrueForge sandbox envelope fails closed", () => {
  const result = indexSandboxExec().toolResultFrom({
    type: "tool.response",
    id: "response-exec-malformed",
    threadId: "main",
    toolCallId: "call-exec",
    content: JSON.stringify({ success: true, response: { result: "looks good" } }),
  });

  assert.equal(result.status, "ERROR");
  assert.equal(result.retryable, false);
  assert.equal(result.errorCode, "MALFORMED_TOOL_RESPONSE");
});

test("non-JSON tool response fails closed instead of becoming OK", () => {
  const result = indexToolCall().toolResultFrom({
    type: "tool.response",
    id: "response-malformed",
    threadId: "main",
    toolCallId: "call-1",
    content: "command failed before producing structured output",
  });

  assert.equal(result.status, "ERROR");
  assert.equal(result.retryable, false);
  assert.equal(result.errorCode, "MALFORMED_TOOL_RESPONSE");
  assert.match(result.stderrPreview ?? "", /command failed/);
});

test("JSON scalar tool response is a schema failure", () => {
  const result = indexToolCall().toolResultFrom({
    type: "tool.response",
    id: "response-scalar",
    threadId: "main",
    toolCallId: "call-1",
    content: JSON.stringify("looks successful"),
  });

  assert.equal(result.status, "ERROR");
  assert.equal(result.errorCode, "MALFORMED_TOOL_RESPONSE");
});

test("approval event resolves exact tool name and arguments", () => {
  const index = new TrueForgeEventIndex();
  index.ingest({
    type: "model.message",
    id: "message-2",
    threadId: "main",
    toolCalls: [
      {
        id: "call-pr",
        type: "function",
        function: { name: "create_pull_request", arguments: '{"owner":"cmdr-chara"}' },
        toolInfo: { type: "mcp", serverName: "github", name: "create_pull_request" },
      },
    ],
  });
  const approval = index.approvalFrom({
    type: "tool.approval_required",
    id: "approval-event",
    threadId: "main",
    toolCalls: [{ id: "call-pr", sourceEventId: "message-2" }],
  });
  assert.equal(approval.toolCalls[0]?.name, "create_pull_request");
  assert.equal(approval.toolCalls[0]?.arguments, '{"owner":"cmdr-chara"}');
});
