import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SessionState } from "../../domain/src/types";
import { validateSessionState } from "../../domain/src/validation";

export interface SessionStore {
  save(state: SessionState): Promise<void>;
  load(taskId: string): Promise<SessionState | undefined>;
}

export class JsonSessionStore implements SessionStore {
  public constructor(private readonly directory: string) {}

  public async save(state: SessionState): Promise<void> {
    validateSessionState(state);
    const target = this.pathFor(state.task.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }

  public async load(taskId: string): Promise<SessionState | undefined> {
    try {
      const content = await readFile(this.pathFor(taskId), "utf8");
      return validateSessionState(JSON.parse(content) as SessionState);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  private pathFor(taskId: string): string {
    const safe = taskId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.directory, `${safe}.json`);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
