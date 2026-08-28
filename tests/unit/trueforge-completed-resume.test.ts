import assert from "node:assert/strict";
import { test } from "node:test";
import { replayListedTurnEvents } from "../../packages/trueforge/src";

async function* listedEvents(): AsyncIterable<unknown> {
  yield {
    id: "event-3",
    type: "turn.created",
    turnId: "turn-1",
    sequenceNumber: 3,
    createdAt: "2026-08-27T12:00:03.000Z",
  };
  yield {
    id: "event-4",
    type: "model.message",
    sequenceNumber: 4,
    createdAt: "2026-08-27T12:00:04.000Z",
    content: "already processed",
  };
  yield {
    id: "event-7",
    type: "turn.done",
    sequenceNumber: 7,
    createdAt: "2026-08-27T12:00:07.000Z",
    state: { status: "done", requiredActions: [] },
  };
}

test("completed resume skips persisted history and advances to maximum observed sequence", async () => {
  const observed: number[] = [];
  const replay = await replayListedTurnEvents(listedEvents(), 4, (event) => {
    if (event.sequenceNumber !== undefined) observed.push(event.sequenceNumber);
  });

  assert.equal(replay.lastSequenceNumber, 7);
  assert.deepEqual(observed, [7]);
  assert.deepEqual(replay.events.map((event) => event.sequenceNumber), [7]);
});
