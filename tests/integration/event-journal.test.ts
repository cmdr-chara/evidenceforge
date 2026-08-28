import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EventJournal } from "../../packages/telemetry/src";

test("event journal preserves traceable runtime IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-journal-"));
  try {
    const journal = new EventJournal(join(directory, "events.jsonl"));
    await journal.append({
      id: "event-1",
      type: "TOOL_RESULT",
      source: "trueforge:tool.result",
      timestamp: "2026-08-25T18:00:00.000Z",
      payload: { callId: "call-1" },
      sequenceNumber: 12,
    });
    const events = await journal.readAll();
    assert.equal(events[0]?.id, "event-1");
    assert.equal(events[0]?.sequenceNumber, 12);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
