import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Evidence, RuntimeEvent, SessionState } from "../../domain/src/types";
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
  public constructor(private readonly directory: string) {}

  public async save(state: SessionState): Promise<void> {
    const existing = await this.loadCheckpoint(state.task.id);
    await this.saveCheckpoint(state, existing?.evidenceStore ?? new EvidenceStore());
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

    const target = this.pathFor(state.task.id);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const checkpoint: PersistedRuntimeCheckpoint = {
      schemaVersion: 1,
      state: structuredClone(state),
      evidence: evidenceStore.export(),
    };

    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, target);
  }

  public async loadCheckpoint(taskId: string): Promise<RuntimeCheckpoint | undefined> {
    try {
      const content = await readFile(this.pathFor(taskId), "utf8");
      const parsed: unknown = JSON.parse(content);
      const checkpoint = parseCheckpoint(parsed);
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
    const safe = taskId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.directory, `${safe}.checkpoint.json`);
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
  return value as unknown as PersistedRuntimeCheckpoint;
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

  const missing = [...referenced].filter((evidenceId) => !evidenceStore.hasEvidence(evidenceId));
  if (missing.length > 0) {
    throw new Error(
      `runtime checkpoint references missing evidence: ${missing.sort().join(", ")}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
