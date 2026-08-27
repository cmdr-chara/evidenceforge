import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeEvent } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { TrueForgeEventProjector } from "../../packages/trueforge/src";
import { buildState } from "../fixtures/builders";

test("streamed tool-call correlation survives restart before tool response", () => {
  const state = buildState();
  const store = new EvidenceStore();
  const streamed: RuntimeEvent[] = [
    {
      id: "message-restart",
      type: "MODEL_MESSAGE",
      source: "trueforge:model.message",
      threadId: "main",
      timestamp: "2026-08-27T12:00:00.000Z",
      sequenceNumber: 1,
      payload: {
        type: "model.message",
        id: "message-restart",
        threadId: "main",
      },
    },
    {
      id: "message-restart",
      type: "MODEL_MESSAGE",
      source: "trueforge:model.message.delta",
      threadId: "main",
      timestamp: "2026-08-27T12:00:01.000Z",
      sequenceNumber: 2,
      payload: {
        type: "model.message.delta",
        id: "message-restart",
        toolCalls: [
          {
            index: 0,
            id: "call-restart",
            function: {
              name: "exec",
              arguments:
                '{"intent":"evidenceforge.verify:targeted-tests","command":"pnpm',
            },
            toolInfo: { type: "truefoundry-system", name: "sandbox" },
          },
        ],
      },
    },
    {
      id: "message-restart",
      type: "MODEL_MESSAGE",
      source: "trueforge:model.message.delta",
      threadId: "main",
      timestamp: "2026-08-27T12:00:02.000Z",
      sequenceNumber: 3,
      payload: {
        type: "model.message.delta",
        id: "message-restart",
        toolCalls: [
          {
            index: 0,
            function: {
              arguments: ' test","cwd":"/workspace/repository"}',
            },
          },
        ],
        finishReason: "tool_calls",
      },
    },
  ];
  for (const event of streamed) store.recordEvent(event);

  const restartedProjector = new TrueForgeEventProjector(undefined, store);
  const response: RuntimeEvent = {
    id: "response-after-restart",
    type: "TOOL_RESULT",
    source: "trueforge:tool.response",
    threadId: "main",
    timestamp: "2026-08-27T12:00:03.000Z",
    sequenceNumber: 4,
    payload: {
      type: "tool.response",
      id: "response-after-restart",
      threadId: "main",
      toolCallId: "call-restart",
      content: JSON.stringify({
        success: true,
        response: { exitCode: 0, result: "tests passed" },
      }),
    },
  };
  store.recordEvent(response);

  const projection = restartedProjector.project(state, response);

  assert.equal(projection.toolResult?.tool, "sandbox.exec");
  assert.equal(projection.toolResult?.status, "OK");
  assert.equal(projection.verificationResult?.status, "PASS");
  assert.equal(
    state.successCriteria.find((criterion) => criterion.id === "targeted-tests")?.status,
    "PASS",
  );
  assert.equal(store.listEvents().length, 4);
  assert.equal(store.listEvidence().length, 1);
});
