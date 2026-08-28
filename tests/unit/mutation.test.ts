import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StructuredMutationCoordinator } from "../../packages/tools/src";

test("structured mutation verifies base and emits patch digests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-mutation-"));
  const path = join(directory, "fixture.txt");
  const original = "alpha\nbeta\ngamma\n";
  await writeFile(path, original);
  const metadata = await new StructuredMutationCoordinator().apply({
    path,
    expectedBaseDigest: sha256(original),
    edits: [{ target: "beta", replacement: "fixed" }],
  });
  assert.equal(await readFile(path, "utf8"), "alpha\nfixed\ngamma\n");
  assert.match(metadata.patchDigest, /^[a-f0-9]{64}$/);
  assert.equal(metadata.baseDigest, sha256(original));
  assert.equal(metadata.changedRanges.length, 1);
});

test("structured mutation rejects ambiguous, overlapping, and stale edits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-mutation-negative-"));
  const coordinator = new StructuredMutationCoordinator();
  const ambiguous = join(directory, "ambiguous.txt");
  await writeFile(ambiguous, "same same");
  await assert.rejects(
    coordinator.apply({
      path: ambiguous,
      expectedBaseDigest: sha256("same same"),
      edits: [{ target: "same", replacement: "other" }],
    }),
    /ambiguous/,
  );

  const overlap = join(directory, "overlap.txt");
  await writeFile(overlap, "abcdef");
  await assert.rejects(
    coordinator.apply({
      path: overlap,
      expectedBaseDigest: sha256("abcdef"),
      edits: [
        { target: "abcde", replacement: "x" },
        { target: "cdef", replacement: "y" },
      ],
    }),
    /overlap/,
  );
  await assert.rejects(
    coordinator.apply({
      path: overlap,
      expectedBaseDigest: sha256("stale"),
      edits: [{ target: "abc", replacement: "x" }],
    }),
    /base digest mismatch/,
  );
});

test("concurrent mutations to one file are serialized against exact base state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidenceforge-mutation-serialized-"));
  const path = join(directory, "fixture.txt");
  const original = "before";
  await writeFile(path, original);
  const coordinator = new StructuredMutationCoordinator();
  const requests = ["first", "second"].map((replacement) =>
    coordinator.apply({
      path,
      expectedBaseDigest: sha256(original),
      edits: [{ target: "before", replacement }],
    }),
  );
  const outcomes = await Promise.allSettled(requests);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
