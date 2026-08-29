import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LiveIncidentService } from "../../apps/server/src/live-service";
import { SseBroker } from "../../apps/server/src/sse-broker";
import { EvidenceStore } from "../../packages/evidence/src";
import {
  JsonRuntimeCheckpointStore,
  RuntimeCheckpoint,
} from "../../packages/persistence/src";
import { buildState } from "../fixtures/builders";

interface RecoveringLiveIncidentService {
  requireCheckpoint(taskId: string): Promise<RuntimeCheckpoint>;
}

test("legacy live checkpoint recovery persists the configured head before continuation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-live-head-recovery-"));
  const previousDirectory = process.env.EVIDENCEFORGE_DATA_DIR;
  const broker = new SseBroker();
  try {
    process.env.EVIDENCEFORGE_DATA_DIR = directory;
    const checkpoints = new JsonRuntimeCheckpointStore(join(directory, "checkpoints"));
    const state = buildState();
    delete state.livePullRequestHead;
    await checkpoints.saveCheckpoint(state, new EvidenceStore());

    const service = new LiveIncidentService(broker, "codex/recovered-live-proof");
    const restored = await (
      service as unknown as RecoveringLiveIncidentService
    ).requireCheckpoint(state.task.id);

    assert.equal(restored.state.livePullRequestHead, "codex/recovered-live-proof");
    assert.equal(
      (await checkpoints.loadCheckpoint(state.task.id))?.state.livePullRequestHead,
      "codex/recovered-live-proof",
    );
  } finally {
    broker.close();
    if (previousDirectory === undefined) delete process.env.EVIDENCEFORGE_DATA_DIR;
    else process.env.EVIDENCEFORGE_DATA_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy live checkpoint recovery preserves its durable approval target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-live-head-approval-"));
  const previousDirectory = process.env.EVIDENCEFORGE_DATA_DIR;
  const broker = new SseBroker();
  try {
    process.env.EVIDENCEFORGE_DATA_DIR = directory;
    const checkpoints = new JsonRuntimeCheckpointStore(join(directory, "checkpoints"));
    const state = buildState();
    delete state.livePullRequestHead;
    state.approvals.push({
      id: "approval-legacy",
      action: "github.create_pull_request",
      normalizedArguments: { head: "codex/original-live-proof" },
      risk: "EXTERNAL_REVERSIBLE",
      reason: "legacy live proof",
      reversible: true,
      status: "PENDING",
    });
    await checkpoints.saveCheckpoint(state, new EvidenceStore());

    const service = new LiveIncidentService(broker, "codex/new-process-setting");
    const restored = await (
      service as unknown as RecoveringLiveIncidentService
    ).requireCheckpoint(state.task.id);

    assert.equal(restored.state.livePullRequestHead, "codex/original-live-proof");
    assert.equal(
      (await checkpoints.loadCheckpoint(state.task.id))?.state.livePullRequestHead,
      "codex/original-live-proof",
    );
  } finally {
    broker.close();
    if (previousDirectory === undefined) delete process.env.EVIDENCEFORGE_DATA_DIR;
    else process.env.EVIDENCEFORGE_DATA_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy live checkpoint recovery rejects conflicting durable targets before migration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-live-head-conflict-"));
  const previousDirectory = process.env.EVIDENCEFORGE_DATA_DIR;
  const broker = new SseBroker();
  try {
    process.env.EVIDENCEFORGE_DATA_DIR = directory;
    const checkpoints = new JsonRuntimeCheckpointStore(join(directory, "checkpoints"));
    const state = buildState();
    delete state.livePullRequestHead;
    for (const [id, head] of [
      ["approval-one", "codex/live-proof-one"],
      ["approval-two", "codex/live-proof-two"],
    ] as const) {
      state.approvals.push({
        id,
        action: "github.create_pull_request",
        normalizedArguments: { head },
        risk: "EXTERNAL_REVERSIBLE",
        reason: "legacy live proof",
        reversible: true,
        status: "PENDING",
      });
    }
    await checkpoints.saveCheckpoint(state, new EvidenceStore());

    const service = new LiveIncidentService(broker, "codex/new-process-setting");
    await assert.rejects(
      () => (
        service as unknown as RecoveringLiveIncidentService
      ).requireCheckpoint(state.task.id),
      /conflicting pull-request heads/,
    );
    assert.equal(
      (await checkpoints.loadCheckpoint(state.task.id))?.state.livePullRequestHead,
      undefined,
    );
  } finally {
    broker.close();
    if (previousDirectory === undefined) delete process.env.EVIDENCEFORGE_DATA_DIR;
    else process.env.EVIDENCEFORGE_DATA_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});
