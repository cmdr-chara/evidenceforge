import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createSessionState,
  createTask,
  RuntimeEvent,
} from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { JsonRuntimeCheckpointStore } from "../../packages/persistence/src";
import { EventJournal } from "../../packages/telemetry/src";
import {
  DurableTrueForgeRuntime,
  RunTurnInput,
  StreamResult,
  TrueForgeRuntimeAdapter,
} from "../../packages/trueforge/src";
import { buildCiSuccessContract } from "../../packages/workflow/src";

class VerifierAdapter implements TrueForgeRuntimeAdapter {
  public async createSession(): Promise<string> {
    return "tf-checkpoint-session";
  }

  public async runTurn(input: RunTurnInput): Promise<StreamResult> {
    const events = verifierEvents();
    for (const event of events) await input.onEvent?.(event);
    return {
      sessionId: input.sessionId,
      turnId: "turn-checkpoint",
      lastSequenceNumber: 2,
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

test("TrueForge verifier evidence survives a process-level checkpoint restore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-runtime-checkpoint-"));
  try {
    const task = createTask({
      id: "task-runtime-checkpoint",
      objective: "Resolve the failed CI run",
      repository: "cmdr-chara/evidenceforge",
      revision: "abc123",
      runId: "842",
      createdAt: "2026-08-25T20:05:00.000Z",
    });
    const state = createSessionState(task, buildCiSuccessContract(task));
    const evidenceStore = new EvidenceStore();
    const checkpoints = new JsonRuntimeCheckpointStore(join(directory, "checkpoints"));
    const runtime = new DurableTrueForgeRuntime(
      new VerifierAdapter(),
      checkpoints,
      evidenceStore,
      new EventJournal(join(directory, "events.jsonl")),
    );

    await runtime.start(state, "run the immutable verifier manifest");

    const afterRestart = await new JsonRuntimeCheckpointStore(
      join(directory, "checkpoints"),
    ).loadCheckpoint(task.id);
    assert.ok(afterRestart);
    assert.equal(afterRestart.state.trueForgeSessionId, "tf-checkpoint-session");
    assert.equal(afterRestart.state.activeTurnId, "turn-checkpoint");
    assert.equal(afterRestart.state.lastSequenceNumber, 2);

    const criterion = afterRestart.state.successCriteria.find(
      (candidate) => candidate.id === "targeted-tests",
    );
    assert.ok(criterion);
    assert.equal(criterion.status, "PASS");
    assert.equal(afterRestart.state.verifierResults.length, 1);
    assert.equal(afterRestart.evidenceStore.listEvents().length, 2);
    assert.equal(afterRestart.evidenceStore.listEvidence().length, 1);
    assert.equal(
      afterRestart.evidenceStore.isAdmissibleForCriterion(
        criterion.evidenceIds[0] as string,
        criterion,
      ),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function verifierEvents(): RuntimeEvent[] {
  return [
    {
      id: "message-checkpoint-verifier",
      type: "MODEL_MESSAGE",
      source: "trueforge:model.message",
      threadId: "main",
      timestamp: "2026-08-25T20:05:01.000Z",
      sequenceNumber: 1,
      payload: {
        type: "model.message",
        id: "message-checkpoint-verifier",
        thread_id: "main",
        tool_calls: [
          {
            id: "call-checkpoint-verifier",
            type: "function",
            function: {
              name: "exec",
              arguments: JSON.stringify({
                intent: "evidenceforge.verify:targeted-tests",
                command: "pnpm test",
                cwd: "/workspace/repository",
              }),
            },
            tool_info: { type: "truefoundry-system", name: "sandbox" },
          },
        ],
      },
    },
    {
      id: "response-checkpoint-verifier",
      type: "TOOL_RESULT",
      source: "trueforge:tool.response",
      threadId: "main",
      timestamp: "2026-08-25T20:05:02.000Z",
      sequenceNumber: 2,
      payload: {
        type: "tool.response",
        id: "response-checkpoint-verifier",
        thread_id: "main",
        tool_call_id: "call-checkpoint-verifier",
        content: JSON.stringify({
          success: true,
          response: { exitCode: 0, result: "targeted tests passed" },
        }),
      },
    },
  ];
}
