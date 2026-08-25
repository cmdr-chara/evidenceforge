import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { JsonSessionStore } from "../../packages/persistence/src";
import { buildState } from "../fixtures/builders";

test("session state persists and resumes with TrueForge cursor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-"));
  try {
    const store = new JsonSessionStore(directory);
    const state = buildState();
    state.trueForgeSessionId = "sess-abc";
    state.activeTurnId = "turn-123";
    state.lastSequenceNumber = 47;
    await store.save(state);
    const restored = await store.load(state.task.id);
    assert.equal(restored?.trueForgeSessionId, "sess-abc");
    assert.equal(restored?.activeTurnId, "turn-123");
    assert.equal(restored?.lastSequenceNumber, 47);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
