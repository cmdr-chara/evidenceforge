import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateSandboxCommand,
  validateSearchLogsInput,
  validateSearchRepositoryInput,
} from "../../packages/tools/src";

test("bounded log retrieval prevents giant context dumps", () => {
  assert.throws(() =>
    validateSearchLogsInput({ artifactRef: "artifact://log", query: "error", maxMatches: 100, contextLines: 3 }),
  );
});

test("bounded repository search caps result count", () => {
  assert.throws(() => validateSearchRepositoryInput({ query: "config", maxResults: 21 }));
});

test("sandbox command policy rejects sudo", () => {
  assert.throws(() =>
    validateSandboxCommand({
      argv: ["sudo", "rm", "-rf", "/"],
      cwd: "/workspace/repository",
      timeoutSeconds: 30,
      network: "DISABLED",
      maxOutputBytes: 10_000,
    }),
  );
});
