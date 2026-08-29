import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_LIVE_PULL_REQUEST_HEAD } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { JsonRuntimeCheckpointStore } from "../../packages/persistence/src";
import { buildState } from "../fixtures/builders";

test("legacy live checkpoint loading restores the historical pull-request head", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-live-head-legacy-"));
  try {
    const writer = new JsonRuntimeCheckpointStore(directory);
    const state = buildState();
    delete state.livePullRequestHead;
    await writer.saveCheckpoint(state, new EvidenceStore());

    const restored = await new JsonRuntimeCheckpointStore(directory).loadCheckpoint(
      state.task.id,
    );

    assert.equal(restored?.state.livePullRequestHead, DEFAULT_LIVE_PULL_REQUEST_HEAD);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("configured live pull-request head survives checkpoint reconstruction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-live-head-configured-"));
  try {
    const writer = new JsonRuntimeCheckpointStore(directory);
    const state = buildState();
    state.livePullRequestHead = "codex/persisted-live-proof";
    await writer.saveCheckpoint(state, new EvidenceStore());

    const restored = await new JsonRuntimeCheckpointStore(directory).loadCheckpoint(
      state.task.id,
    );

    assert.equal(restored?.state.livePullRequestHead, "codex/persisted-live-proof");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
