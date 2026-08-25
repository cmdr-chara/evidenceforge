import {
  CompletionCertificateData,
  GateDecision,
  GateFailure,
  SessionState,
} from "../../domain/src/types";
import { EvidenceStore } from "../../evidence/src";

const issuedCertificates = new WeakSet<object>();

export function isIssuedCompletionCertificate(value: CompletionCertificateData): boolean {
  return issuedCertificates.has(value);
}

export class CompletionGate {
  public constructor(private readonly evidenceStore: EvidenceStore) {}

  public evaluate(state: SessionState, generatedAt = new Date().toISOString()): GateDecision {
    const failures: GateFailure[] = [];
    const required = state.successCriteria.filter((criterion) => criterion.required);

    for (const criterion of required) {
      if (criterion.status !== "PASS") {
        failures.push({
          code: "REQUIRED_CRITERION_NOT_PASSING",
          criterionId: criterion.id,
          message: `${criterion.id} is ${criterion.status}, not PASS`,
        });
        continue;
      }
      if (!this.evidenceStore.criterionHasAdmissibleEvidence(criterion)) {
        failures.push({
          code: "MISSING_ADMISSIBLE_EVIDENCE",
          criterionId: criterion.id,
          message: `${criterion.id} has no admissible PASS evidence`,
        });
      }
      const deterministicFailure = state.verifierResults.find(
        (result) => result.criterionId === criterion.id && result.deterministic && result.status === "FAIL",
      );
      if (deterministicFailure !== undefined) {
        failures.push({
          code: "DETERMINISTIC_FAILURE",
          criterionId: criterion.id,
          message: deterministicFailure.details,
        });
      }
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

    if (state.externalAction !== undefined && state.externalAction.status !== "RECONCILED") {
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
        evidenceIds: [...criterion.evidenceIds],
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
      traceId: state.traceId,
      generatedAt,
    });
    issuedCertificates.add(certificate);
    return { allowed: true, certificate };
  }
}
