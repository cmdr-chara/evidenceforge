import assert from "node:assert/strict";
import { test } from "node:test";
import { TrueForgeEventIndex } from "../../packages/trueforge/src";

test("TrueForge tool response correlates with the originating model tool call", () => {
  const index = new TrueForgeEventIndex();
  index.ingest({
    type: "model.message",
    id: "message-1",
    threadId: "main",
    toolCalls: [
      {
        id: "call-1",
        type: "function",
        function: { name: "run_command", arguments: '{"argv":["pnpm","test"]}' },
        toolInfo: { type: "mcp", serverName: "daytona", name: "run_command" },
      },
    ],
  });
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
