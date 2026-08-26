import { digestCanonical, SessionState } from "../../domain/src";

export function completionSubjectDigest(state: SessionState): string {
  const requiredCriterionIds = new Set(
    state.successCriteria.filter((criterion) => criterion.required).map((criterion) => criterion.id),
  );
  return digestCanonical({
    sessionVersion: state.version,
    task: state.task,
    phase: state.phase,
    status: state.status,
    requiredCriteria: state.successCriteria.filter((criterion) => criterion.required),
    verifierResults: state.verifierResults.filter((result) =>
      requiredCriterionIds.has(result.criterionId),
    ),
    patchDigest: state.patchDigest ?? null,
    reviewerVerdict: state.reviewerVerdict ?? null,
    approvals: state.approvals,
    operations: state.operations,
    latestRoundEvaluation: state.roundEvaluations.at(-1) ?? null,
    externalAction: state.externalAction ?? null,
    traceId: state.traceId,
  });
}
