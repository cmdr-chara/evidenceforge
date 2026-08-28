import {
  ArtifactBinding,
  CompletionCertificateData,
  digestCanonical,
  EvidenceScope,
  SessionState,
} from "../../domain/src";

export interface CompletionSubjectSnapshot {
  taskId: string;
  repository: string;
  revision: string;
  patchDigest: string;
  stateVersion: number;
  successContractDigest: string;
  stateDigest: string;
}

export function successContractDigest(state: SessionState): string {
  return digestCanonical({
    task: {
      id: state.task.id,
      repository: state.task.repository,
      revision: state.task.revision,
    },
    criteria: state.successCriteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      required: criterion.required,
      verifier: criterion.verifier,
      evidenceScope: criterion.evidenceScope,
    })),
  });
}

export function artifactBindingFor(
  state: SessionState,
  scope: EvidenceScope,
): ArtifactBinding {
  if (scope !== "INCIDENT" && state.patchDigest === undefined) {
    throw new Error(`${scope.toLowerCase()} evidence requires a patch digest`);
  }
  return {
    taskId: state.task.id,
    repository: state.task.repository,
    revision: state.task.revision,
    successContractDigest: successContractDigest(state),
    stateVersion: state.version,
    scope,
    patchDigest: scope === "INCIDENT" ? undefined : state.patchDigest,
  };
}

export function artifactBindingMatchesState(
  binding: ArtifactBinding | undefined,
  state: SessionState,
  scope: EvidenceScope,
): boolean {
  if (binding === undefined || binding.scope !== scope) return false;
  if (!Number.isInteger(binding.stateVersion) || binding.stateVersion < 1) return false;
  if (binding.stateVersion > state.version) return false;
  if (
    binding.taskId !== state.task.id ||
    binding.repository !== state.task.repository ||
    binding.revision !== state.task.revision ||
    binding.successContractDigest !== successContractDigest(state)
  ) {
    return false;
  }
  return scope === "INCIDENT"
    ? binding.patchDigest === undefined
    : state.patchDigest !== undefined && binding.patchDigest === state.patchDigest;
}

export function completionStateDigest(state: SessionState): string {
  const requiredIds = new Set(
    state.successCriteria.filter((criterion) => criterion.required).map((criterion) => criterion.id),
  );
  return digestCanonical({
    version: state.version,
    task: state.task,
    phase: state.phase,
    status: state.status,
    successContractDigest: successContractDigest(state),
    requiredCriteria: state.successCriteria.filter((criterion) => criterion.required),
    verifierResults: state.verifierResults.filter((result) => requiredIds.has(result.criterionId)),
    evidenceIds: state.evidenceIds,
    patchDigest: state.patchDigest ?? null,
    reviewerVerdict: state.reviewerVerdict ?? null,
    reviewBinding: state.reviewBinding ?? null,
    approvals: state.approvals,
    operations: state.operations,
    latestRoundEvaluation: state.roundEvaluations.at(-1) ?? null,
    externalAction: state.externalAction ?? null,
    terminalSequenceNumber: state.terminalSequenceNumber ?? null,
    traceId: state.traceId,
  });
}

export function completionSubjectSnapshot(state: SessionState): CompletionSubjectSnapshot {
  if (state.patchDigest === undefined) throw new Error("completion subject requires a patch digest");
  return {
    taskId: state.task.id,
    repository: state.task.repository,
    revision: state.task.revision,
    patchDigest: state.patchDigest,
    stateVersion: state.version,
    successContractDigest: successContractDigest(state),
    stateDigest: completionStateDigest(state),
  };
}

export function completionSubjectDigest(state: SessionState): string {
  return digestCanonical(completionSubjectSnapshot(state));
}

export function completionCertificatePayloadDigest(
  certificate: CompletionCertificateData,
): string {
  const { payloadDigest: _payloadDigest, ...payload } = certificate;
  return digestCanonical(payload);
}
