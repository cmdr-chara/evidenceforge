import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeEvent } from "../../packages/domain/src";
import {
  DiagnosticContractGuard,
  evaluateDiagnosticContract,
  REQUIRED_DIAGNOSTIC_SPECIALISTS,
  TRUEFORGE_SPECIALIST_TOOL_BUDGET,
} from "../../packages/trueforge/src";

test("diagnostic contract accepts exactly three completed named specialists", () => {
  assert.equal(evaluateDiagnosticContract(validTurn()), undefined);
});

test("diagnostic contract rejects a second fan-out", () => {
  const events = validTurn().slice(0, -1);
  events.push(threadCreated("thread-4", REQUIRED_DIAGNOSTIC_SPECIALISTS[0]));
  assert.equal(evaluateDiagnosticContract(events)?.code, "DUPLICATE_SPECIALIST");
});

test("diagnostic contract rejects child threads not parented by the supervisor", () => {
  const events = [turnCreated(), threadCreated("thread-1", REQUIRED_DIAGNOSTIC_SPECIALISTS[0], "thread-other")];
  assert.equal(evaluateDiagnosticContract(events)?.code, "INVALID_PARENT");
});

test("diagnostic contract rejects a specialist after its tool budget", () => {
  const events = [turnCreated(), threadCreated("thread-1", REQUIRED_DIAGNOSTIC_SPECIALISTS[0])];
  for (let index = 0; index <= TRUEFORGE_SPECIALIST_TOOL_BUDGET; index += 1) {
    events.push(toolResult("thread-1", index));
  }
  assert.equal(evaluateDiagnosticContract(events)?.code, "TOOL_BUDGET_EXCEEDED");
});

test("diagnostic contract rejects a failed specialist", () => {
  const created = threadCreated("thread-1", REQUIRED_DIAGNOSTIC_SPECIALISTS[0]);
  const done = threadDone("thread-1");
  (done.payload as { state?: { status: string } }).state = { status: "error" };
  assert.equal(evaluateDiagnosticContract([turnCreated(), created, done])?.code, "FAILED_SPECIALIST");
});

test("diagnostic contract rejects a completed specialist without terminal status", () => {
  const done = threadDone("thread-1");
  delete (done.payload as { state?: unknown }).state;
  assert.equal(
    evaluateDiagnosticContract([
      turnCreated(),
      threadCreated("thread-1", REQUIRED_DIAGNOSTIC_SPECIALISTS[0]),
      done,
    ])?.code,
    "FAILED_SPECIALIST",
  );
});

test("diagnostic contract rejects missing thread correlation", () => {
  const result = toolResult("thread-1", 0);
  delete result.threadId;
  assert.equal(
    evaluateDiagnosticContract([
      turnCreated(),
      threadCreated("thread-1", REQUIRED_DIAGNOSTIC_SPECIALISTS[0]),
      result,
    ])?.code,
    "MALFORMED_EVENT",
  );
});

test("diagnostic contract rejects invalid turn ordering", () => {
  assert.equal(evaluateDiagnosticContract([turnDone()])?.code, "INVALID_TURN_ORDER");
  assert.equal(
    evaluateDiagnosticContract([turnCreated(), turnCreated("turn-2")])?.code,
    "INVALID_TURN_ORDER",
  );
});

test("diagnostic contract rejects a successful turn with an incomplete fan-out", () => {
  const events = [
    turnCreated(),
    threadCreated("thread-1", REQUIRED_DIAGNOSTIC_SPECIALISTS[0]),
    threadDone("thread-1"),
    turnDone(),
  ];
  assert.equal(evaluateDiagnosticContract(events)?.code, "INCOMPLETE_FAN_OUT");
});

test("diagnostic contract scopes counts to the current turn", () => {
  const events = [...validTurn(), turnCreated("turn-2"), turnDone("turn-2")];
  assert.equal(evaluateDiagnosticContract(events), undefined);
});

test("diagnostic contract forbids a later diagnostic fan-out", () => {
  const events = [
    ...validTurn(),
    turnCreated("turn-2"),
    threadCreated("late-thread", REQUIRED_DIAGNOSTIC_SPECIALISTS[0]),
  ];
  assert.equal(evaluateDiagnosticContract(events)?.code, "DUPLICATE_SPECIALIST");
});

test("diagnostic contract restores the current tool budget from checkpoint events", () => {
  const events = [turnCreated(), threadCreated("thread-1", REQUIRED_DIAGNOSTIC_SPECIALISTS[0])];
  for (let index = 0; index < TRUEFORGE_SPECIALIST_TOOL_BUDGET - 1; index += 1) {
    events.push(toolResult("thread-1", index));
  }
  const guard = new DiagnosticContractGuard(events);
  assert.equal(
    guard.observe(toolResult("thread-1", TRUEFORGE_SPECIALIST_TOOL_BUDGET - 1)),
    undefined,
  );
  assert.equal(
    guard.observe(toolResult("thread-1", TRUEFORGE_SPECIALIST_TOOL_BUDGET))?.code,
    "TOOL_BUDGET_EXCEEDED",
  );
});

function validTurn(turnId = "turn-1"): RuntimeEvent[] {
  return [
    turnCreated(turnId),
    ...REQUIRED_DIAGNOSTIC_SPECIALISTS.map((name, index) =>
      threadCreated(`thread-${index + 1}-${turnId}`, name),
    ),
    ...REQUIRED_DIAGNOSTIC_SPECIALISTS.map((_name, index) =>
      threadDone(`thread-${index + 1}-${turnId}`),
    ),
    turnDone(turnId),
  ];
}

function turnCreated(turnId = "turn-1"): RuntimeEvent {
  return event(`created-${turnId}`, "TURN_CREATED", { type: "turn.created", turnId });
}

function turnDone(turnId = "turn-1"): RuntimeEvent {
  return event(`done-${turnId}`, "TURN_DONE", {
    type: "turn.done",
    turnId,
    state: { status: "done" },
  });
}

function threadCreated(
  threadId: string,
  name: string,
  parentThreadId = "main",
): RuntimeEvent {
  return {
    ...event(`created-${threadId}`, "THREAD_CREATED", {
      type: "thread.created",
      threadId,
      agentInfo: { type: "dynamic", name },
      parent: { threadId: parentThreadId, toolCallId: `call-${threadId}` },
    }),
    threadId,
  };
}

function threadDone(threadId: string): RuntimeEvent {
  return {
    ...event(`done-${threadId}`, "THREAD_DONE", {
      type: "thread.done",
      threadId,
      state: { status: "done" },
    }),
    threadId,
  };
}

function toolResult(threadId: string, index: number): RuntimeEvent {
  return {
    ...event(`tool-${threadId}-${index}`, "TOOL_RESULT", { type: "tool.response", threadId }),
    threadId,
  };
}

function event(id: string, type: RuntimeEvent["type"], payload: unknown): RuntimeEvent {
  return {
    id,
    type,
    source: `trueforge:${String((payload as { type?: string }).type ?? "unknown")}`,
    timestamp: "2026-08-26T14:00:00.000Z",
    payload,
  };
}
