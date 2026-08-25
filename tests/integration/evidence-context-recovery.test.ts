import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEvidence, EvidenceStore } from "../../packages/evidence/src";
import { JsonRuntimeCheckpointStore } from "../../packages/persistence/src";
import { buildState } from "../fixtures/builders";

test("model-facing compaction leaves authoritative evidence intact across restart", async () => {
  const store = new EvidenceStore();
  for (let index = 0; index < 4; index += 1) {
    const eventId = `event-context-${index}`;
    store.recordEvent({
      id: eventId,
      type: "TOOL_RESULT",
      source: "fixture",
      timestamp: "2026-08-25T18:00:00.000Z",
      payload: { complete: `authoritative-result-${index}` },
    });
    store.recordEvidence(
      createEvidence({
        id: `evidence-context-${index}`,
        kind: "OBSERVATION",
        sourceEventId: eventId,
        sourceTool: "fixture-tool",
        claim: `full authoritative claim ${index} ${"x".repeat(80)}`,
        artifactRefs: [`artifact://${index}/complete.json`],
        timestamp: "2026-08-25T18:00:01.000Z",
      }),
    );
  }
  const before = store.authoritativeSnapshot();
  const view = store.modelFacingView({ maxItems: 2, maxClaimCharacters: 24 });
  assert.equal(view.items.length, 2);
  assert.equal(view.omittedItems, 2);
  assert.equal(view.truncated, true);
  assert.deepEqual(store.authoritativeSnapshot(), before);

  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-context-checkpoint-"));
  const checkpoint = new JsonRuntimeCheckpointStore(directory);
  const state = buildState();
  await checkpoint.saveCheckpoint(state, store);
  const restored = await checkpoint.loadCheckpoint(state.task.id);
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored?.evidenceStore.authoritativeSnapshot())),
    JSON.parse(JSON.stringify(before)),
  );
});
