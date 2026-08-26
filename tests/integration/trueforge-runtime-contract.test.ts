import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RuntimeEvent } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { JsonSessionStore } from "../../packages/persistence/src";
import { EventJournal } from "../../packages/telemetry/src";
import {
  DurableTrueForgeRuntime,
  REQUIRED_DIAGNOSTIC_SPECIALISTS,
  RunTurnInput,
  StreamResult,
  TrueForgeRuntimeAdapter,
} from "../../packages/trueforge/src";
import { buildState } from "../fixtures/builders";

class ContractAdapter implements TrueForgeRuntimeAdapter {
  public cancellations = 0;

  public constructor(private readonly cancellationFails = false) {}

  public async createSession(): Promise<string> {
    return "tf-contract-session";
  }

  public async cancelSession(sessionId: string): Promise<void> {
    assert.equal(sessionId, "tf-contract-session");
    this.cancellations += 1;
    if (this.cancellationFails) throw new Error("simulated cancellation transport failure");
  }

  public async runTurn(input: RunTurnInput): Promise<StreamResult> {
    const events = duplicateFanOut();
    for (const event of events) await input.onEvent?.(event);
    return {
      sessionId: input.sessionId,
      turnId: "turn-contract",
      lastSequenceNumber: events.length,
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

test("runtime blocks and cancels once when TrueForge starts a second fan-out", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-contract-"));
  try {
    const adapter = new ContractAdapter();
    const state = buildState();
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      new JsonSessionStore(join(root, "sessions")),
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
    );

    await runtime.start(state, "investigate");

    assert.equal(state.status, "BLOCKED");
    assert.equal(state.phase, "BLOCKED");
    assert.equal(state.blockedReason, "TrueForge diagnostic fan-out created a duplicate specialist");
    assert.equal(adapter.cancellations, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime remains durably blocked when cancellation transport fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-contract-cancel-"));
  try {
    const adapter = new ContractAdapter(true);
    const sessions = new JsonSessionStore(join(root, "sessions"));
    const state = buildState();
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      sessions,
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
    );

    await runtime.start(state, "investigate");

    assert.equal(state.status, "BLOCKED");
    assert.equal(adapter.cancellations, 1);
    assert.equal((await sessions.load(state.task.id))?.status, "BLOCKED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function duplicateFanOut(): RuntimeEvent[] {
  const events: RuntimeEvent[] = [
    event("turn", "TURN_CREATED", { type: "turn.created", turnId: "turn-contract" }),
  ];
  for (const [index, name] of REQUIRED_DIAGNOSTIC_SPECIALISTS.entries()) {
    events.push(threadCreated(`thread-${index + 1}`, name));
  }
  events.push(threadCreated("thread-4", REQUIRED_DIAGNOSTIC_SPECIALISTS[0]));
  events.push(
    event("after-violation", "MODEL_MESSAGE", { type: "model.message", threadId: "main" }),
  );
  return events.map((candidate, index) => ({ ...candidate, sequenceNumber: index + 1 }));
}

function threadCreated(threadId: string, name: string): RuntimeEvent {
  return {
    ...event(`created-${threadId}`, "THREAD_CREATED", {
      type: "thread.created",
      threadId,
      agentInfo: { type: "dynamic", name },
      parent: { threadId: "main", toolCallId: `call-${threadId}` },
    }),
    threadId,
  };
}

function event(id: string, type: RuntimeEvent["type"], payload: unknown): RuntimeEvent {
  const runtimePayload: Record<string, unknown> = {
    ...(payload as Record<string, unknown>),
    id,
  };
  return {
    id,
    type,
    source: `trueforge:${String(runtimePayload.type ?? "unknown")}`,
    timestamp: "2026-08-26T14:00:00.000Z",
    payload: runtimePayload,
  };
}
