import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { RuntimeEvent } from "../../domain/src/types";

export class EventJournal {
  public constructor(private readonly path: string) {}

  public async append(event: RuntimeEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  public async readAll(): Promise<RuntimeEvent[]> {
    try {
      const content = await readFile(this.path, "utf8");
      return content
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as RuntimeEvent);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
