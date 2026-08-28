import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { resolveEvidenceForgeDataDirectory } from "../../apps/server/src/live-service";

test("live persistence resolves the configured EvidenceForge data directory", () => {
  assert.equal(
    resolveEvidenceForgeDataDirectory("/workspace", "state/evidenceforge"),
    resolve("/workspace", "state/evidenceforge"),
  );
});

test("live persistence defaults blank configuration to .data", () => {
  assert.equal(resolveEvidenceForgeDataDirectory("/workspace", "  "), resolve("/workspace", ".data"));
  assert.equal(resolveEvidenceForgeDataDirectory("/workspace", undefined), resolve("/workspace", ".data"));
});
