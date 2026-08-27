import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvidence, EvidenceIntegrityError, EvidenceStore } from "../../packages/evidence/src";

test("evidence cannot reference unknown runtime event", () => {
  const store = new EvidenceStore();
  assert.throws(
    () =>
      store.recordEvidence(
        createEvidence({
          kind: "VERIFICATION",
          sourceEventId: "missing-event",
          sourceTool: "daytona.run",
          claim: "tests passed",
          outcome: "PASS",
        }),
      ),
    EvidenceIntegrityError,
  );
});

test("event and evidence identifiers are immutable snapshots", () => {
  const store = new EvidenceStore();
  const event = {
    id: "event-1",
    type: "TOOL_RESULT" as const,
    source: "fixture",
    timestamp: new Date().toISOString(),
    payload: { value: 1 },
  };
  store.recordEvent(event);
  const copy = store.getEvent("event-1");
  assert.ok(copy);
  (copy.payload as { value: number }).value = 2;
  assert.deepEqual(store.getEvent("event-1")?.payload, { value: 1 });
});

test("event IDs are idempotent only for an exact event and reject conflicts", () => {
  const store = new EvidenceStore();
  const event = {
    id: "event-conflict",
    type: "TOOL_RESULT" as const,
    source: "fixture",
    timestamp: "2026-08-25T18:00:00.000Z",
    payload: { value: 1 },
  };

  assert.equal(store.recordEvent(event), true);
  assert.equal(store.recordEvent(structuredClone(event)), false);
  assert.throws(
    () => store.recordEvent({ ...event, payload: { value: 2 } }),
    /conflicting payload/,
  );
  assert.deepEqual(store.listEvents(), [event]);
});
