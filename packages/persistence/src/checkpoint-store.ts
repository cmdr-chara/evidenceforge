import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_LIVE_PULL_REQUEST_HEAD,
  Evidence,
  RuntimeEvent,
  SessionState,
  SuccessCriterion,
} from "../../domain/src/types";
import { validateSessionState } from "../../domain/src/validation";
import { EvidenceStore } from "../../evidence/src";
import { SessionStore } from "./session-store";

export interface RuntimeCheckpoint {
  state: SessionState;
  evidenceStore: EvidenceStore;
}

export interface RuntimeCheckpointStore extends SessionStore {
  saveCheckpoint(state: SessionState, evidenceStore: EvidenceStore): Promise<void>;
  loadCheckpoint(taskId: string): Promise<RuntimeCheckpoint | undefined>;
}

interface PersistedRuntimeCheckpoint {
  schemaVersion: 1;
  state: SessionState;
  evidence: {
    events: RuntimeEvent[];
    evidence: Evidence[];
  };
}

export class JsonRuntimeCheckpointStore implements RuntimeCheckpointStore {
  private readonly writeChains = new Map<string, Promise<void>>();

  public constructor(private readonly directory: string) {}

  public async save(state: SessionState): Promise<void> {
    validateSessionState(state);
    const snapshot = structuredClone(state);
    await this.enqueue(state.task.id, async () => {
      const existing = await this.loadCheckpoint(snapshot.task.id);
      await this.writeCheckpoint(
        snapshot,
        (existing?.evidenceStore ?? new EvidenceStore()).export(),
      );
    });
  }

  public async load(taskId: string): Promise<SessionState | undefined> {
    const checkpoint = await this.loadCheckpoint(taskId);
    return checkpoint?.state;
  }

  public async saveCheckpoint(
    state: SessionState,
    evidenceStore: EvidenceStore,
  ): Promise<void> {
    validateSessionState(state);
    validateEvidenceReferences(state, evidenceStore);
    const stateSnapshot = structuredClone(state);
    const evidenceSnapshot = evidenceStore.export();
    await this.enqueue(state.task.id, async () => {
      await this.writeCheckpoint(stateSnapshot, evidenceSnapshot);
    });
  }

  public async loadCheckpoint(taskId: string): Promise<RuntimeCheckpoint | undefined> {
    const current = await this.readCheckpoint(this.pathFor(taskId), taskId);
    if (current !== undefined) return current;
    return this.readCheckpoint(this.legacyPathFor(taskId), taskId);
  }

  private async writeCheckpoint(
    state: SessionState,
    evidence: PersistedRuntimeCheckpoint["evidence"],
  ): Promise<void> {
    const evidenceStore = EvidenceStore.restore(evidence);
    validateEvidenceReferences(state, evidenceStore);
    const target = this.pathFor(state.task.id);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const checkpoint: PersistedRuntimeCheckpoint = {
      schemaVersion: 1,
      state: structuredClone(state),
      evidence: structuredClone(evidence),
    };

    await mkdir(dirname(target), { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async readCheckpoint(
    path: string,
    taskId: string,
  ): Promise<RuntimeCheckpoint | undefined> {
    try {
      const content = await readFile(path, "utf8");
      const parsed: unknown = JSON.parse(content);
      const checkpoint = parseCheckpoint(parsed);
      if (checkpoint.state.task.id !== taskId) {
        throw new Error(`checkpoint for ${taskId} contains task ${checkpoint.state.task.id}`);
      }
      const state = validateSessionState(checkpoint.state);
      const evidenceStore = EvidenceStore.restore(checkpoint.evidence);
      validateEvidenceReferences(state, evidenceStore);
      return { state, evidenceStore };
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  private pathFor(taskId: string): string {
    return join(this.directory, `task-${taskDigest(taskId)}.checkpoint.json`);
  }

  private legacyPathFor(taskId: string): string {
    const safe = taskId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.directory, `${safe}.checkpoint.json`);
  }

  private async enqueue(taskId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.writeChains.get(taskId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    this.writeChains.set(taskId, current);
    try {
      await current;
    } finally {
      if (this.writeChains.get(taskId) === current) this.writeChains.delete(taskId);
    }
  }
}

export function isRuntimeCheckpointStore(
  store: SessionStore,
): store is RuntimeCheckpointStore {
  const candidate = store as Partial<RuntimeCheckpointStore>;
  return (
    typeof candidate.saveCheckpoint === "function" &&
    typeof candidate.loadCheckpoint === "function"
  );
}

function parseCheckpoint(value: unknown): PersistedRuntimeCheckpoint {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("unsupported or malformed runtime checkpoint");
  }
  if (!isRecord(value.state) || !isRecord(value.evidence)) {
    throw new Error("runtime checkpoint is missing state or evidence");
  }
  if (!Array.isArray(value.evidence.events) || !Array.isArray(value.evidence.evidence)) {
    throw new Error("runtime checkpoint evidence payload must contain arrays");
  }
  value.state.operations ??= [];
  value.state.roundEvaluations ??= [];
  value.state.toolAttempts ??= [];
  value.state.livePullRequestHead ??= DEFAULT_LIVE_PULL_REQUEST_HEAD;
  if (Array.isArray(value.state.successCriteria)) {
    for (const candidate of value.state.successCriteria) {
      if (!isRecord(candidate) || !isRecord(candidate.verifier)) continue;
      candidate.evidenceScope ??= inferEvidenceScope(
        candidate.verifier as unknown as SuccessCriterion["verifier"],
      );
    }
  }
  return value as unknown as PersistedRuntimeCheckpoint;
}

function inferEvidenceScope(
  verifier: SuccessCriterion["verifier"],
): SuccessCriterion["evidenceScope"] {
  if (
    verifier.kind === "FAILURE_SIGNATURE" ||
    (verifier.kind === "COMMAND" && verifier.purpose === "REPRODUCTION")
  ) {
    return "INCIDENT";
  }
  return verifier.kind === "EXTERNAL_STATE" ? "EXTERNAL" : "PATCH";
}

function validateEvidenceReferences(
  state: SessionState,
  evidenceStore: EvidenceStore,
): void {
  const referenced = new Set<string>(state.evidenceIds);
  for (const criterion of state.successCriteria) {
    for (const evidenceId of criterion.evidenceIds) referenced.add(evidenceId);
  }
  for (const result of state.verifierResults) {
    for (const evidenceId of result.evidenceIds) referenced.add(evidenceId);
  }
  if (state.externalAction?.evidenceId !== undefined) {
    referenced.add(state.externalAction.evidenceId);
  }
  if (state.completionCertificate !== undefined) {
    for (const criterion of state.completionCertificate.requiredCriteria) {
      for (const evidenceId of criterion.evidenceIds) referenced.add(evidenceId);
    }
    if (state.completionCertificate.externalAction !== undefined) {
      referenced.add(state.completionCertificate.externalAction.evidenceId);
    }
  }
  for (const operation of state.operations) {
    const settlement = operation.settlement;
    for (const evidenceId of settlement?.evidenceIds ?? []) referenced.add(evidenceId);
    if (
      settlement !== undefined &&
      evidenceStore.getEvent(settlement.runtimeEventId) === undefined
    ) {
      throw new Error(
        `operation ${operation.id} settlement references missing runtime event ${settlement.runtimeEventId}`,
      );
    }
  }

  const missing = [...referenced].filter((evidenceId) => !evidenceStore.hasEvidence(evidenceId));
  if (missing.length > 0) {
    throw new Error(
      `runtime checkpoint references missing evidence: ${missing.sort().join(", ")}`,
    );
  }
}

function taskDigest(taskId: string): string {
  return createHash("sha256").update(taskId, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
