import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceStore } from "../../packages/evidence/src";
import { NoProgressDetector } from "../../packages/workflow/src";
import { buildState } from "../fixtures/builders";

test("equivalent failed commands route reconsider, replan, then escalation", () => {
  const state = buildState();
  const store = new EvidenceStore();
  const detector = new NoProgressDetector();
  const base = {
    tool: "sandbox.exec",
    workspaceRevision: "abc123",
    resultSignature: "exit 1 after 103ms",
    evidenceIds: [],
    stateDigest: "unchanged",
  };
  assert.equal(detector.observe(state, { ...base, normalizedArguments: { command: "pnpm  test" } }).outcome, "PROGRESS");
  assert.equal(detector.observe(state, { ...base, normalizedArguments: { command: " pnpm test " } }, store).outcome, "RECONSIDER");
  assert.equal(detector.observe(state, { ...base, normalizedArguments: { command: "pnpm test" } }, store).outcome, "REPLAN");
  assert.equal(detector.observe(state, { ...base, normalizedArguments: { command: "pnpm test" } }, store).outcome, "ESCALATE");
  assert.ok(state.evidenceIds.length >= 3);
});

test("new evidence resets a repeated-attempt sequence", () => {
  const state = buildState();
  const detector = new NoProgressDetector();
  const base = {
    tool: "repository.search",
    normalizedArguments: { query: "error signature" },
    workspaceRevision: "abc123",
    resultSignature: "no matches",
    stateDigest: "same",
  };
  detector.observe(state, { ...base, evidenceIds: [] });
  const result = detector.observe(state, { ...base, evidenceIds: ["new-observation"] });
  assert.equal(result.outcome, "PROGRESS");
});
