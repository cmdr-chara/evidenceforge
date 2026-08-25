import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EvidenceStore } from "../../packages/evidence/src";
import {
  DurableOperationRunner,
  JsonRuntimeCheckpointStore,
  OperationEffectUncertainError,
} from "../../packages/persistence/src";
import { createOperationIntent, decideOperationRecovery } from "../../packages/workflow/src";
import { buildState } from "../fixtures/builders";

test("intent and settlement survive restart around a consequential effect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-operation-"));
  const store = new JsonRuntimeCheckpointStore(directory);
  const evidence = new EvidenceStore();
  evidence.recordEvent({
    id: "github-event-219",
    type: "TOOL_RESULT",
    source: "github-mcp",
    timestamp: "2026-08-25T18:03:00.000Z",
    payload: { number: 219 },
  });
  const state = buildState();
  const intent = createOperationIntent({
    id: "operation-pull-request",
    actionType: "github.create_pull_request",
    tool: "github-mcp.create-pull-request",
    normalizedArguments: { head: "fix/demo", base: "main" },
    repository: state.task.repository,
    revision: state.task.revision,
    risk: "EXTERNAL_REVERSIBLE",
    replayPolicy: "RECONCILE_FIRST",
    expectedEvidence: ["github pull request"],
    idempotencyKey: "pr-fixture",
  });

  await new DurableOperationRunner(store, evidence).run(state, intent, async () => ({
    authoritativeResult: { number: 219 },
    runtimeEventId: "github-event-219",
    evidenceIds: [],
    nextWorkflowState: "REVIEWING",
    settledAt: "2026-08-25T18:03:00.000Z",
  }));

  const restored = await store.loadCheckpoint(state.task.id);
  const operation = restored?.state.operations[0];
  assert.equal(operation?.status, "SETTLED");
  assert.deepEqual(operation?.settlement?.authoritativeResult, { number: 219 });
  assert.equal(decideOperationRecovery(operation!).action, "NEXT");
});

test("crash after effect start persists uncertainty instead of claiming failure or success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-operation-crash-"));
  const store = new JsonRuntimeCheckpointStore(directory);
  const state = buildState();
  const intent = createOperationIntent({
    id: "operation-uncertain-pr",
    actionType: "github.create_pull_request",
    tool: "github-mcp.create-pull-request",
    normalizedArguments: { head: "fix/demo", base: "main" },
    repository: state.task.repository,
    revision: state.task.revision,
    risk: "EXTERNAL_REVERSIBLE",
    replayPolicy: "RECONCILE_FIRST",
    expectedEvidence: ["github pull request"],
  });

  await assert.rejects(
    new DurableOperationRunner(store, new EvidenceStore()).run(state, intent, async () => {
      throw new Error("transport disappeared after request transmission");
    }),
    OperationEffectUncertainError,
  );
  const restored = await store.loadCheckpoint(state.task.id);
  const operation = restored?.state.operations[0];
  assert.equal(operation?.status, "EFFECT_UNCERTAIN");
  assert.equal(decideOperationRecovery(operation!).action, "RECONCILE");
});

test("a settlement with a missing runtime event is persisted as uncertain", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-operation-event-gap-"));
  const store = new JsonRuntimeCheckpointStore(directory);
  const state = buildState();
  const intent = createOperationIntent({
    id: "operation-missing-event",
    actionType: "repository.read",
    tool: "repository.read",
    normalizedArguments: { path: "README.md" },
    repository: state.task.repository,
    revision: state.task.revision,
    risk: "READ_ONLY",
    replayPolicy: "SAFE",
    expectedEvidence: ["file contents"],
  });
  await assert.rejects(
    new DurableOperationRunner(store, new EvidenceStore()).run(state, intent, async () => ({
      authoritativeResult: { content: "not durably correlated" },
      runtimeEventId: "missing-runtime-event",
      evidenceIds: [],
      nextWorkflowState: "INVESTIGATING",
      settledAt: "2026-08-25T18:04:00.000Z",
    })),
    OperationEffectUncertainError,
  );
  const restored = await store.loadCheckpoint(state.task.id);
  assert.equal(restored?.state.operations[0]?.status, "EFFECT_UNCERTAIN");
});
