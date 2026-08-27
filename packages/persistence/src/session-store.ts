import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SessionState } from "../../domain/src/types";
import { validateSessionState } from "../../domain/src/validation";

export interface SessionStore {
  save(state: SessionState): Promise<void>;
  load(taskId: string): Promise<SessionState | undefined>;
}

export class JsonSessionStore implements SessionStore {
  private readonly writeChains = new Map<string, Promise<void>>();

  public constructor(private readonly directory: string) {}

  public async save(state: SessionState): Promise<void> {
    validateSessionState(state);
    const snapshot = structuredClone(state);
    await this.enqueue(state.task.id, async () => {
      const target = this.pathFor(snapshot.task.id);
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
      await mkdir(dirname(target), { recursive: true });
      try {
        await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    });
  }

  public async load(taskId: string): Promise<SessionState | undefined> {
    const current = await this.readPath(this.pathFor(taskId), taskId);
    if (current !== undefined) return current;
    return this.readPath(this.legacyPathFor(taskId), taskId);
  }

  private async readPath(path: string, taskId: string): Promise<SessionState | undefined> {
    try {
      const content = await readFile(path, "utf8");
      const state = validateSessionState(JSON.parse(content) as SessionState);
      if (state.task.id !== taskId) {
        throw new Error(`session file for ${taskId} contains task ${state.task.id}`);
      }
      return state;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  private pathFor(taskId: string): string {
    return join(this.directory, `task-${taskDigest(taskId)}.json`);
  }

  private legacyPathFor(taskId: string): string {
    const safe = taskId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.directory, `${safe}.json`);
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

function taskDigest(taskId: string): string {
  return createHash("sha256").update(taskId, "utf8").digest("hex");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
