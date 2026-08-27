import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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

test("session filenames do not collide for a/b and a_b", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-collision-"));
  try {
    const store = new JsonSessionStore(directory);
    const slash = buildState();
    slash.task.id = "a/b";
    slash.activeTurnId = "turn-slash";
    const underscore = buildState();
    underscore.task.id = "a_b";
    underscore.activeTurnId = "turn-underscore";

    await Promise.all([store.save(slash), store.save(underscore)]);

    assert.equal((await store.load("a/b"))?.activeTurnId, "turn-slash");
    assert.equal((await store.load("a_b"))?.activeTurnId, "turn-underscore");
    assert.equal((await readdir(directory)).filter((name) => name.endsWith(".json")).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent session saves are serialized in invocation order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-save-order-"));
  try {
    const store = new JsonSessionStore(directory);
    const first = buildState();
    first.activeTurnId = "turn-first";
    const second = structuredClone(first);
    second.activeTurnId = "turn-second";
    second.version += 1;

    await Promise.all([store.save(first), store.save(second)]);

    assert.equal((await store.load(first.task.id))?.activeTurnId, "turn-second");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("session store reads legacy sanitized filenames without destructive migration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-legacy-session-"));
  try {
    const state = buildState();
    state.task.id = "a/b";
    state.activeTurnId = "legacy-turn";
    const legacyPath = join(directory, "a_b.json");
    await writeFile(legacyPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const restored = await new JsonSessionStore(directory).load("a/b");

    assert.equal(restored?.activeTurnId, "legacy-turn");
    assert.ok((await readdir(directory)).includes("a_b.json"));
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

test("runtime checkpoints isolate evidence by task including colliding legacy IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-checkpoint-isolation-"));
  try {
    const store = new JsonRuntimeCheckpointStore(directory);
    const first = buildState();
    first.task.id = "a/b";
    const firstEvidence = new EvidenceStore();
    passCriterion(first, firstEvidence, "tests");

    const second = buildState();
    second.task.id = "a_b";
    const secondEvidence = new EvidenceStore();
    passCriterion(second, secondEvidence, "review");

    await Promise.all([
      store.saveCheckpoint(first, firstEvidence),
      store.saveCheckpoint(second, secondEvidence),
    ]);

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
    assert.notEqual(restoredFirst?.state.task.id, restoredSecond?.state.task.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
