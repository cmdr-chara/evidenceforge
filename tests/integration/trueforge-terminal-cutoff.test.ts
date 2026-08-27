import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RuntimeEvent } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { JsonRuntimeCheckpointStore } from "../../packages/persistence/src";
import { EventJournal } from "../../packages/telemetry/src";
import {
  DurableTrueForgeRuntime,
  RunTurnInput,
  StreamResult,
  TrueForgeRuntimeAdapter,
} from "../../packages/trueforge/src";
import { buildState } from "../fixtures/builders";

class LateEventAdapter implements TrueForgeRuntimeAdapter {
  public async createSession(): Promise<string> {
    return "terminal-cutoff-session";
  }

  public async cancelSession(): Promise<void> {}

  public async runTurn(input: RunTurnInput): Promise<StreamResult> {
    const events = terminalThenLateApproval();
    for (const event of events) await input.onEvent?.(event);
    return {
      sessionId: input.sessionId,
      turnId: "turn-terminal-cutoff",
      lastSequenceNumber: 3,
      events,
      paused: false,
      requiredActions: [],
    };
  }

  public async submitApprovals(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }
}

test("late actionable events cannot mutate or persist after terminal cutoff", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-terminal-cutoff-"));
  try {
    const state = buildState();
    state.phase = "INVESTIGATING";
    const evidenceStore = new EvidenceStore();
    const checkpoints = new JsonRuntimeCheckpointStore(join(directory, "checkpoints"));
    const runtime = new DurableTrueForgeRuntime(
      new LateEventAdapter(),
      checkpoints,
      evidenceStore,
      new EventJournal(join(directory, "events.jsonl")),
    );

    await runtime.start(state, "trigger a terminal condition and a buffered late event");

    assert.equal(state.status, "BLOCKED");
    assert.equal(state.phase, "BLOCKED");
    assert.equal(state.terminalSequenceNumber, 2);
    assert.equal(state.lastSequenceNumber, 2);
    assert.equal(state.approvals.length, 0);
    assert.deepEqual(evidenceStore.listEvents().map((event) => event.sequenceNumber), [1, 2]);

    const restored = await checkpoints.loadCheckpoint(state.task.id);
    assert.ok(restored);
    assert.equal(restored.state.status, "BLOCKED");
    assert.equal(restored.state.terminalSequenceNumber, 2);
    assert.equal(restored.state.approvals.length, 0);
    assert.deepEqual(
      restored.evidenceStore.listEvents().map((event) => event.sequenceNumber),
      [1, 2],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function terminalThenLateApproval(): RuntimeEvent[] {
  return [
    {
      id: "model-before-terminal",
      type: "MODEL_MESSAGE",
      source: "trueforge:model.message",
      threadId: "main",
      timestamp: "2026-08-27T12:10:01.000Z",
      sequenceNumber: 1,
      payload: {
        type: "model.message",
        id: "model-before-terminal",
        threadId: "main",
        toolCalls: [
          {
            id: "call-late-pr",
            type: "function",
            function: {
              name: "create_pull_request",
              arguments: JSON.stringify({ owner: "cmdr-chara", repo: "evidenceforge" }),
            },
            toolInfo: { type: "mcp", serverName: "github" },
          },
        ],
      },
    },
    {
      id: "auth-terminal",
      type: "AUTH_REQUIRED",
      source: "trueforge:mcp.auth_required",
      threadId: "main",
      timestamp: "2026-08-27T12:10:02.000Z",
      sequenceNumber: 2,
      payload: { type: "mcp.auth_required", id: "auth-terminal" },
    },
    {
      id: "approval-after-terminal",
      type: "APPROVAL",
      source: "trueforge:tool.approval_required",
      threadId: "main",
      timestamp: "2026-08-27T12:10:03.000Z",
      sequenceNumber: 3,
      payload: {
        type: "tool.approval_required",
        id: "approval-after-terminal",
        threadId: "main",
        toolCalls: [{ id: "call-late-pr" }],
      },
    },
  ];
}
