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
