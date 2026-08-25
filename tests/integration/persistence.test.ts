import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EvidenceStore } from "../../packages/evidence/src";
import {
  JsonRuntimeCheckpointStore,
  JsonSessionStore,
} from "../../packages/persistence/src";
import { buildState, passCriterion } from "../fixtures/builders";

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

test("runtime checkpoint restores session, events, and admissible evidence together", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-checkpoint-"));
  try {
    const writer = new JsonRuntimeCheckpointStore(directory);
    const state = buildState();
    const evidenceStore = new EvidenceStore();
    passCriterion(state, evidenceStore, "tests");
    state.trueForgeSessionId = "sess-checkpoint";
    state.activeTurnId = "turn-checkpoint";
    state.lastSequenceNumber = 23;

    await writer.saveCheckpoint(state, evidenceStore);

    const reader = new JsonRuntimeCheckpointStore(directory);
    const restored = await reader.loadCheckpoint(state.task.id);
    assert.ok(restored);
    assert.equal(restored.state.trueForgeSessionId, "sess-checkpoint");
    assert.equal(restored.state.activeTurnId, "turn-checkpoint");
    assert.equal(restored.state.lastSequenceNumber, 23);
    assert.ok(restored.evidenceStore.getEvent("event-tests"));
    assert.ok(restored.evidenceStore.getEvidence("evidence-tests"));
    const criterion = restored.state.successCriteria.find((item) => item.id === "tests");
    assert.ok(criterion);
    assert.equal(
      restored.evidenceStore.isAdmissibleForCriterion("evidence-tests", criterion),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("checkpoint refuses a state that references evidence not persisted with it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-checkpoint-missing-"));
  try {
    const store = new JsonRuntimeCheckpointStore(directory);
    const state = buildState();
    state.evidenceIds.push("evidence-missing");

    await assert.rejects(
      store.saveCheckpoint(state, new EvidenceStore()),
      /references missing evidence: evidence-missing/,
    );
    assert.equal(await store.loadCheckpoint(state.task.id), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime checkpoints isolate evidence by task", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-checkpoint-isolation-"));
  try {
    const store = new JsonRuntimeCheckpointStore(directory);
    const first = buildState();
    first.task.id = "task-first";
    const firstEvidence = new EvidenceStore();
    passCriterion(first, firstEvidence, "tests");

    const second = buildState();
    second.task.id = "task-second";
    const secondEvidence = new EvidenceStore();
    passCriterion(second, secondEvidence, "review");

    await store.saveCheckpoint(first, firstEvidence);
    await store.saveCheckpoint(second, secondEvidence);

    const restoredFirst = await store.loadCheckpoint(first.task.id);
    const restoredSecond = await store.loadCheckpoint(second.task.id);
    assert.deepEqual(
      restoredFirst?.evidenceStore.listEvidence().map((item) => item.id),
      ["evidence-tests"],
    );
    assert.deepEqual(
      restoredSecond?.evidenceStore.listEvidence().map((item) => item.id),
      ["evidence-review"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
