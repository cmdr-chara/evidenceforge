import { createHash } from "node:crypto";
import {
  createSessionState,
  createTask,
  pendingCriterion,
  RuntimeEvent,
  SessionState,
  SuccessCriterion,
  VerificationResult,
} from "../../packages/domain/src";
import { createEvidence, EvidenceStore } from "../../packages/evidence/src";
import { artifactBindingFor, ProgressEvaluator } from "../../packages/verification/src";

export function baseCriteria(): SuccessCriterion[] {
  return [
    pendingCriterion("failure-reproduced", "Original failure reproduced", {
      kind: "FAILURE_SIGNATURE",
      argv: ["pnpm", "test"],
      cwd: "/workspace/repository",
      expectedNonZeroExit: true,
      signature: "CONFIG_VALIDATION_ORDER",
      timeoutSeconds: 60,
    }),
    pendingCriterion("tests", "Targeted tests pass", {
      kind: "COMMAND",
      argv: ["pnpm", "test"],
      cwd: "/workspace/repository",
      expectedExitCode: 0,
      timeoutSeconds: 60,
      purpose: "VERIFICATION",
    }),
    pendingCriterion("review", "Independent review passes", {
      kind: "REVIEWER",
      allowedVerdicts: ["PASS", "PASS_WITH_WARNINGS"],
    }),
  ];
}

export function buildState(criteria = baseCriteria()): SessionState {
  const task = createTask({
    id: "task-fixture",
    objective: "Resolve failed CI",
    repository: "cmdr-chara/evidenceforge-fixture",
    revision: "abc123",
    runId: "842",
    createdAt: "2026-08-25T18:00:00.000Z",
  });
  const state = createSessionState(task, criteria);
  state.patchDigest = createHash("sha256").update("patch").digest("hex");
  state.reviewerVerdict = "PASS";
  state.reviewBinding = artifactBindingFor(state, "PATCH");
  return state;
}

export function passCriterion(
  state: SessionState,
  store: EvidenceStore,
  criterionId: string,
  options?: { modelOnly?: boolean; deterministic?: boolean },
): void {
  const criterion = state.successCriteria.find((item) => item.id === criterionId);
  if (criterion === undefined) throw new Error(`missing criterion ${criterionId}`);
  const event: RuntimeEvent = {
    id: `event-${criterionId}`,
    type: options?.modelOnly
      ? "MODEL_MESSAGE"
      : criterion.verifier.kind === "EXTERNAL_STATE"
        ? "EXTERNAL_RECONCILIATION"
        : "TOOL_RESULT",
    source: options?.modelOnly ? "trueforge:model.message" : "fixture",
    timestamp: "2026-08-25T18:01:00.000Z",
    payload: {},
  };
  store.recordEvent(event);
  const kind =
    criterion.verifier.kind === "FAILURE_SIGNATURE"
      ? "REPRODUCTION"
      : criterion.verifier.kind === "REVIEWER"
        ? "REVIEW"
        : criterion.verifier.kind === "EXTERNAL_STATE"
          ? "EXTERNAL_RESULT"
          : "VERIFICATION";
  const binding = artifactBindingFor(state, criterion.evidenceScope);
  const evidence = createEvidence({
    id: `evidence-${criterionId}`,
    kind,
    sourceEventId: event.id,
    sourceTool: options?.modelOnly
      ? "model.prose"
      : kind === "REVIEW"
        ? "independent-reviewer"
        : "fixture-tool",
    claim: `${criterionId} passed`,
    outcome: "PASS",
    binding,
    timestamp: "2026-08-25T18:01:01.000Z",
  });
  store.recordEvidence(evidence);
  criterion.status = "PASS";
  criterion.evidenceIds = [evidence.id];
  const result: VerificationResult = {
    criterionId,
    status: "PASS",
    verifier: criterion.verifier.kind,
    evidenceIds: [evidence.id],
    details: "fixture pass",
    deterministic: options?.deterministic ?? criterion.verifier.kind !== "REVIEWER",
    binding,
  };
  state.verifierResults.push(result);
  state.evidenceIds.push(evidence.id);
}

export function passAll(state: SessionState, store: EvidenceStore): void {
  for (const criterion of state.successCriteria) passCriterion(state, store, criterion.id);
  new ProgressEvaluator(store).evaluate(state, "VERIFICATION", "2026-08-25T18:02:00.000Z");
}
