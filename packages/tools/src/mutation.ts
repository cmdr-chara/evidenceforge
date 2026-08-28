import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ExactTextEdit {
  target: string;
  replacement: string;
}

export interface StructuredMutationRequest {
  path: string;
  expectedBaseDigest: string;
  edits: ExactTextEdit[];
}

export interface PatchMetadata {
  path: string;
  baseDigest: string;
  resultDigest: string;
  patchDigest: string;
  changedRanges: Array<{ start: number; end: number; replacementLength: number }>;
  patch: string;
}

export class StructuredMutationCoordinator {
  private readonly queues = new Map<string, Promise<void>>();

  public async apply(request: StructuredMutationRequest): Promise<PatchMetadata> {
    const path = resolve(request.path);
    const prior = this.queues.get(path) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    const queued = prior.then(() => current);
    this.queues.set(path, queued);
    await prior;
    try {
      return await applyExactEdits({ ...request, path });
    } finally {
      release();
      if (this.queues.get(path) === queued) this.queues.delete(path);
    }
  }
}

async function applyExactEdits(request: StructuredMutationRequest): Promise<PatchMetadata> {
  if (request.edits.length === 0) throw new Error("structured mutation requires at least one edit");
  const original = await readFile(request.path, "utf8");
  const baseDigest = sha256(original);
  if (baseDigest !== request.expectedBaseDigest.toLowerCase()) {
    throw new Error(`base digest mismatch for ${request.path}`);
  }

  const ranges = request.edits.map((edit) => {
    if (edit.target.length === 0) throw new Error("edit target cannot be empty");
    const start = original.indexOf(edit.target);
    if (start < 0) throw new Error(`exact edit target was not found in ${request.path}`);
    if (original.indexOf(edit.target, start + 1) >= 0) {
      throw new Error(`exact edit target is ambiguous in ${request.path}`);
    }
    return { start, end: start + edit.target.length, replacement: edit.replacement };
  });
  const ascending = [...ranges].sort((left, right) => left.start - right.start);
  for (let index = 1; index < ascending.length; index += 1) {
    const previous = ascending[index - 1];
    const current = ascending[index];
    if (previous !== undefined && current !== undefined && current.start < previous.end) {
      throw new Error(`structured edits overlap in ${request.path}`);
    }
  }

  let result = original;
  for (const range of [...ranges].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, range.start)}${range.replacement}${result.slice(range.end)}`;
  }
  const resultDigest = sha256(result);
  const changedRanges = ascending.map((range) => ({
    start: range.start,
    end: range.end,
    replacementLength: range.replacement.length,
  }));
  const patch = renderPatch(request.path, original, result);
  const patchDigest = sha256(
    JSON.stringify({ path: request.path, baseDigest, resultDigest, changedRanges, patch }),
  );
  const temporary = `${dirname(request.path)}/.${randomUUID()}.evidenceforge.tmp`;
  const fileMode = (await stat(request.path)).mode;
  try {
    await writeFile(temporary, result, { encoding: "utf8", mode: fileMode });
    await rename(temporary, request.path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return { path: request.path, baseDigest, resultDigest, patchDigest, changedRanges, patch };
}

function renderPatch(path: string, before: string, after: string): string {
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ sha256:${sha256(before)}..${sha256(after)} @@`,
    `-${before}`,
    `+${after}`,
  ].join("\n");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
