import {
  CompletionCertificateData,
  GateDecision,
  GateFailure,
  SessionState,
  SuccessCriterion,
  VerificationResult,
} from "../../domain/src/types";
import { EvidenceStore } from "../../evidence/src";
import { completionSubjectDigest } from "./completion-subject";
import { roundEvaluationMatchesState } from "./progress-evaluator";

const issuedCertificates = new WeakSet<object>();

export function isIssuedCompletionCertificate(value: CompletionCertificateData): boolean {
  return issuedCertificates.has(value);
}

export class CompletionGate {
  public constructor(private readonly evidenceStore: EvidenceStore) {}

  public evaluate(state: SessionState, generatedAt = new Date().toISOString()): GateDecision {
    const failures: GateFailure[] = [];
    const required = state.successCriteria.filter((criterion) => criterion.required);
    const acceptedEvidenceIds = new Map<string, string[]>();
    const latestRound = state.roundEvaluations.at(-1);

    if (
      latestRound === undefined ||
      latestRound.nextAction !== "COMPLETE_CANDIDATE" ||
      !roundEvaluationMatchesState(state, latestRound)
    ) {
      failures.push({
        code: "ROUND_VERIFICATION_MISSING_OR_STALE",
        message: "a current round-level progress evaluation must make completion admissible",
      });
    }

    const unresolvedOperation = state.operations.find(
      (operation) =>
        operation.status === "EFFECT_STARTED" || operation.status === "EFFECT_UNCERTAIN",
    );
    if (unresolvedOperation !== undefined) {
      failures.push({
        code: "UNCERTAIN_OPERATION_UNRESOLVED",
        message: `operation ${unresolvedOperation.id} has no durable settlement`,
      });
    }

    for (const criterion of required) {
      if (criterion.status !== "PASS") {
        failures.push({
          code: "REQUIRED_CRITERION_NOT_PASSING",
          criterionId: criterion.id,
          message: `${criterion.id} is ${criterion.status}, not PASS`,
        });
        continue;
      }

      const admissibleEvidenceIds = criterion.evidenceIds.filter((evidenceId) =>
        this.evidenceStore.isAdmissibleForCriterion(evidenceId, criterion),
      );
      if (admissibleEvidenceIds.length === 0) {
        failures.push({
          code: "MISSING_ADMISSIBLE_EVIDENCE",
          criterionId: criterion.id,
          message: `${criterion.id} has no admissible PASS evidence`,
        });
      }

      const latestResult = latestVerificationResult(state, criterion.id);
      if (latestResult === undefined) {
        failures.push({
          code: "MISSING_ADMISSIBLE_EVIDENCE",
          criterionId: criterion.id,
          message: `${criterion.id} has no verifier result correlated to its PASS evidence`,
        });
        continue;
      }

      if (latestResult.verifier !== criterion.verifier.kind) {
        failures.push({
          code: "MISSING_ADMISSIBLE_EVIDENCE",
          criterionId: criterion.id,
          message: `${criterion.id} latest verifier ${latestResult.verifier} does not match ${criterion.verifier.kind}`,
        });
        continue;
      }

      if (latestResult.status !== "PASS") {
        failures.push({
          code:
            latestResult.deterministic && latestResult.status === "FAIL"
              ? "DETERMINISTIC_FAILURE"
              : "REQUIRED_CRITERION_NOT_PASSING",
          criterionId: criterion.id,
          message: latestResult.details,
        });
        continue;
      }

      if (criterion.verifier.kind !== "REVIEWER" && !latestResult.deterministic) {
        failures.push({
          code: "MISSING_ADMISSIBLE_EVIDENCE",
          criterionId: criterion.id,
          message: `${criterion.id} requires a deterministic verifier result`,
        });
        continue;
      }

      const linkedEvidenceIds = latestResult.evidenceIds.filter((evidenceId) =>
        admissibleEvidenceIds.includes(evidenceId),
      );
      if (linkedEvidenceIds.length === 0) {
        failures.push({
          code: "MISSING_ADMISSIBLE_EVIDENCE",
          criterionId: criterion.id,
          message: `${criterion.id} latest PASS result does not reference admissible criterion evidence`,
        });
        continue;
      }
      acceptedEvidenceIds.set(criterion.id, linkedEvidenceIds);
    }

    if (state.patchDigest === undefined || state.patchDigest.trim().length === 0) {
      failures.push({ code: "PATCH_DIGEST_MISSING", message: "patch digest is required" });
    }

    const reproduction = required.find(
      (criterion) => criterion.verifier.kind === "FAILURE_SIGNATURE",
    );
    if (reproduction === undefined || reproduction.status !== "PASS") {
      failures.push({
        code: "ORIGINAL_FAILURE_NOT_REPRODUCED",
        message: "a required failure-signature reproduction criterion must pass",
      });
    }

    if (state.reviewerVerdict !== "PASS" && state.reviewerVerdict !== "PASS_WITH_WARNINGS") {
      failures.push({ code: "REVIEW_BLOCKED", message: "independent reviewer did not pass the patch" });
    }

    const externalCriteria = required.filter(
      (criterion) => criterion.verifier.kind === "EXTERNAL_STATE",
    );
    if (externalCriteria.length > 0) {
      const externalAction = state.externalAction;
      const evidenceIsLinked =
        externalAction?.evidenceId !== undefined &&
        externalCriteria.some((criterion) =>
          acceptedEvidenceIds.get(criterion.id)?.includes(externalAction.evidenceId as string),
        );
      if (
        externalAction?.status !== "RECONCILED" ||
        externalAction.identifier === undefined ||
        externalAction.evidenceId === undefined ||
        !evidenceIsLinked
      ) {
        failures.push({
          code: "EXTERNAL_ACTION_NOT_RECONCILED",
          message: "required external action is missing reconciled, verifier-linked evidence",
        });
      }
    } else if (state.externalAction !== undefined && state.externalAction.status !== "RECONCILED") {
      failures.push({
        code: "EXTERNAL_ACTION_NOT_RECONCILED",
        message: "prepared external action has not been reconciled",
      });
    }

    if (failures.length > 0) return { allowed: false, failures };

    const externalAction = state.externalAction;
    const certificate: CompletionCertificateData = Object.freeze({
      taskId: state.task.id,
      requiredCriteria: required.map((criterion) => ({
        criterionId: criterion.id,
        result: "PASS" as const,
        evidenceIds: [...(acceptedEvidenceIds.get(criterion.id) ?? [])],
      })),
      originalFailureReproduced: true,
      patchDigest: state.patchDigest as string,
      reviewerVerdict: state.reviewerVerdict as "PASS" | "PASS_WITH_WARNINGS",
      externalAction:
        externalAction?.status === "RECONCILED" &&
        externalAction.identifier !== undefined &&
        externalAction.evidenceId !== undefined
          ? {
              type: "pull_request" as const,
              identifier: externalAction.identifier,
              evidenceId: externalAction.evidenceId,
            }
          : undefined,
      subjectDigest: completionSubjectDigest(state),
      traceId: state.traceId,
      generatedAt,
    });
    issuedCertificates.add(certificate);
    return { allowed: true, certificate };
  }
}

function latestVerificationResult(
  state: SessionState,
  criterionId: SuccessCriterion["id"],
): VerificationResult | undefined {
  for (let index = state.verifierResults.length - 1; index >= 0; index -= 1) {
    const result = state.verifierResults[index];
    if (result?.criterionId === criterionId) return result;
  }
  return undefined;
}
