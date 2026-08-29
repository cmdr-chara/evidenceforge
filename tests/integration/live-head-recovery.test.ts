import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  LiveIncidentService,
  LiveRuntimePort,
} from "../../apps/server/src/live-service";
import { SseBroker } from "../../apps/server/src/sse-broker";
import {
  DEFAULT_LIVE_PULL_REQUEST_HEAD,
  digestCanonical,
} from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { JsonRuntimeCheckpointStore } from "../../packages/persistence/src";
import { artifactBindingFor } from "../../packages/verification/src";
import { buildState } from "../fixtures/builders";

function passthroughRuntime(): LiveRuntimePort {
  return {
    start: async (state) => state,
    resume: async (state) => state,
    submitApproval: async (state) => state,
  };
}

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

test("live resume reconstructs its runtime with the checkpointed head", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-live-head-resume-"));
  const previousDirectory = process.env.EVIDENCEFORGE_DATA_DIR;
  const heads: string[] = [];
  try {
    process.env.EVIDENCEFORGE_DATA_DIR = directory;
    const state = buildState();
    state.livePullRequestHead = "codex/persisted-resume-head";
    await new JsonRuntimeCheckpointStore(join(directory, "checkpoints")).saveCheckpoint(
      state,
      new EvidenceStore(),
    );
    const service = new LiveIncidentService(
      new SseBroker(),
      "codex/different-process-head",
      (_store, _taskId, head) => {
        heads.push(head);
        return passthroughRuntime();
      },
    );

    await service.resume(state.task.id);

    assert.deepEqual(heads, ["codex/persisted-resume-head"]);
  } finally {
    if (previousDirectory === undefined) delete process.env.EVIDENCEFORGE_DATA_DIR;
    else process.env.EVIDENCEFORGE_DATA_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});

test("live approval reconstructs its runtime with the checkpointed head", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-live-head-approval-"));
  const previousDirectory = process.env.EVIDENCEFORGE_DATA_DIR;
  const heads: string[] = [];
  try {
    process.env.EVIDENCEFORGE_DATA_DIR = directory;
    const state = buildState();
    state.livePullRequestHead = "codex/persisted-approval-head";
    state.trueForgeSessionId = "session-approval-head";
    const normalizedArguments = { head: "codex/persisted-approval-head" };
    state.approvals.push({
      id: "approval-head",
      action: "github.create_pull_request",
      normalizedArguments,
      risk: "EXTERNAL_REVERSIBLE",
      reason: "live external write",
      reversible: true,
      status: "PENDING",
      toolCallId: "call-approval-head",
      threadId: "main",
      provenance: {
        actionDigest: digestCanonical(normalizedArguments),
        repository: state.task.repository,
        revision: state.task.revision,
        risk: "EXTERNAL_REVERSIBLE",
        originatingOperationId: "operation-approval-head",
        binding: artifactBindingFor(state, "EXTERNAL"),
        issuedAt: "2026-08-29T15:00:00.000Z",
        expiresAt: "2026-08-29T16:00:00.000Z",
      },
    });
    await new JsonRuntimeCheckpointStore(join(directory, "checkpoints")).saveCheckpoint(
      state,
      new EvidenceStore(),
    );
    const service = new LiveIncidentService(
      new SseBroker(),
      "codex/different-process-head",
      (_store, _taskId, head) => {
        heads.push(head);
        return passthroughRuntime();
      },
    );

    await service.decideApproval(state.task.id, "approval-head", "DENIED");

    assert.deepEqual(heads, ["codex/persisted-approval-head"]);
  } finally {
    if (previousDirectory === undefined) delete process.env.EVIDENCEFORGE_DATA_DIR;
    else process.env.EVIDENCEFORGE_DATA_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});
