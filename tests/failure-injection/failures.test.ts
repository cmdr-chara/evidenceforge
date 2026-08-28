import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvidenceForgeAgentSpec, normalizeTrueForgeEvent } from "../../packages/trueforge/src";
import { RecoveryPlanner } from "../../packages/workflow/src";
import { validateSearchLogsInput } from "../../packages/tools/src";
import { CompletionGate } from "../../packages/verification/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { buildState, passCriterion } from "../fixtures/builders";

const empty = { transientAttempts: 0, patchAttempts: 0, replanAttempts: 0 };

test("GitHub 429 uses bounded backoff then escalates", () => {
  const planner = new RecoveryPlanner();
  const first = planner.decide("TRANSIENT", empty);
  const second = planner.decide("TRANSIENT", first.budget);
  const third = planner.decide("TRANSIENT", second.budget);
  assert.equal(first.action, "RETRY");
  assert.equal(second.action, "RETRY");
  assert.equal(third.action, "ESCALATE");
});

test("GitHub 500 uses the same bounded transient policy", () => {
  const decision = new RecoveryPlanner().decide("TRANSIENT", {
    transientAttempts: 2,
    patchAttempts: 0,
    replanAttempts: 0,
  });
  assert.equal(decision.nextPhase, "ESCALATED");
});

test("malformed TrueForge event is normalized without granting evidence", () => {
  const normalized = normalizeTrueForgeEvent("not-an-object", 9);
  assert.equal(normalized.event.sequenceNumber, 9);
  assert.equal(normalized.event.type, "MODEL_MESSAGE");
});

test("sandbox crash triggers recreation policy", () => {
  const decision = new RecoveryPlanner().decide("ENVIRONMENT_FAILURE", empty);
  assert.equal(decision.action, "RECOVER_ENVIRONMENT");
  assert.match(decision.reason, /exact revision/);
});

test("patch still failing triggers replan", () => {
  const decision = new RecoveryPlanner().decide("SEMANTIC_FAILURE", empty);
  assert.equal(decision.nextPhase, "REPLANNING");
});

test("oversized log request is refused in favor of bounded retrieval", () => {
  assert.throws(() =>
    validateSearchLogsInput({
      artifactRef: "artifact://large-log",
      query: "error",
      maxMatches: 100_000,
      contextLines: 1_000,
    }),
  );
});

test("verifier never runs makes completion impossible", () => {
  const state = buildState();
  const store = new EvidenceStore();
  passCriterion(state, store, "failure-reproduced");
  passCriterion(state, store, "review");
  const decision = new CompletionGate(store).evaluate(state);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.ok(
      decision.failures.some(
        (failure) => failure.criterionId === "tests" && failure.code === "REQUIRED_CRITERION_NOT_PASSING",
      ),
    );
  }
});

test("TrueForge approval policy remains enabled for GitHub writes", () => {
  const spec = buildEvidenceForgeAgentSpec({
    baseUrl: "http://localhost:8790",
    model: "openai/gpt-5.2",
    githubMcpName: "github",
    timeoutInSeconds: 600,
  });
  assert.deepEqual(spec.mcp_servers[0]?.require_approval_for_tools, ["@write", "@destructive"]);
});
