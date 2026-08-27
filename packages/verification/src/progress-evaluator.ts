import { randomUUID } from "node:crypto";
import {
  RoundProgressEvaluation,
  SessionState,
  VerificationResult,
} from "../../domain/src";
import { EvidenceStore } from "../../evidence/src";
import {
  artifactBindingFor,
  artifactBindingMatchesState,
} from "./completion-subject";

export class ProgressEvaluator {
  public constructor(private readonly evidenceStore: EvidenceStore) {}

  public evaluate(
    state: SessionState,
    kind: RoundProgressEvaluation["kind"],
    now = new Date().toISOString(),
  ): RoundProgressEvaluation {
    const required = state.successCriteria.filter((criterion) => criterion.required);
    const criteria = required.map((criterion) => {
      const expectedBinding = artifactBindingFor(state, criterion.evidenceScope);
      const admissibleEvidenceIds = criterion.evidenceIds.filter((evidenceId) =>
        this.evidenceStore.isAdmissibleForCriterion(evidenceId, criterion, expectedBinding),
      );
      const latest = latestResult(state, criterion.id);
      const missingEvidence: string[] = [];
      if (admissibleEvidenceIds.length === 0) missingEvidence.push("admissible PASS evidence");
      if (latest === undefined) missingEvidence.push("executed verifier result");
      else if (!artifactBindingMatchesState(latest.binding, state, criterion.evidenceScope)) {
        missingEvidence.push("current subject binding");
      } else if (!latest.evidenceIds.some((id) => admissibleEvidenceIds.includes(id))) {
        missingEvidence.push("verifier-correlated evidence");
      }
      return {
        criterionId: criterion.id,
        status: criterion.status,
        admissibleEvidenceIds,
        missingEvidence,
      };
    });
    const deterministicFailures = required
      .map((criterion) => latestResult(state, criterion.id))
      .filter(
        (result): result is VerificationResult =>
          result !== undefined && result.deterministic && result.status === "FAIL",
      )
      .map((result) => result.criterionId);
    const missingEvidence = criteria.flatMap((criterion) =>
      criterion.missingEvidence.map((missing) => `${criterion.criterionId}: ${missing}`),
    );
    const nextAction =
      deterministicFailures.length > 0 || criteria.some((criterion) => criterion.status === "FAIL")
        ? "REPLAN"
        : criteria.some(
              (criterion) =>
                criterion.status === "PENDING" ||
                criterion.status === "INCONCLUSIVE" ||
                criterion.missingEvidence.length > 0,
            )
          ? "VERIFY"
          : "COMPLETE_CANDIDATE";
    const evaluation: RoundProgressEvaluation = {
      id: `round-${randomUUID()}`,
      kind,
      sessionVersion: state.version,
      patchDigest: state.patchDigest,
      criteria,
      deterministicFailures,
      missingEvidence,
      nextAction,
      evaluatedAt: now,
    };
    state.roundEvaluations.push(structuredClone(evaluation));
    state.version += 1;
    return evaluation;
  }
}

export function roundEvaluationMatchesState(
  state: SessionState,
  evaluation: RoundProgressEvaluation,
): boolean {
  if (evaluation.sessionVersion + 1 !== state.version) return false;
  if (evaluation.patchDigest !== state.patchDigest) return false;
  const required = state.successCriteria.filter((criterion) => criterion.required);
  if (evaluation.criteria.length !== required.length) return false;
  return required.every((criterion) => {
    const evaluated = evaluation.criteria.find((item) => item.criterionId === criterion.id);
    return evaluated?.status === criterion.status && evaluated.missingEvidence.length === 0;
  });
}

function latestResult(
  state: SessionState,
  criterionId: string,
): VerificationResult | undefined {
  for (let index = state.verifierResults.length - 1; index >= 0; index -= 1) {
    const result = state.verifierResults[index];
    if (result?.criterionId === criterionId) return result;
  }
  return undefined;
}
