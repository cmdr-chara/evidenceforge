import {
  Evidence,
  RuntimeEvent,
  SessionState,
  digestCanonical,
} from "../../../packages/domain/src";
import { createEvidence, EvidenceStore } from "../../../packages/evidence/src";
import {
  DIAGNOSTIC_OUTPUT_MAX_CHARACTERS,
  DIAGNOSTIC_OUTPUT_SCHEMA_VERSION,
  DIAGNOSTIC_SPECIALISTS,
  DiagnosticRootCauseClaim,
  parseDiagnosticSpecialistOutput,
} from "../../../packages/specialists/src";
import {
  artifactBindingFor,
  artifactBindingMatchesState,
} from "../../../packages/verification/src";
import { SessionController } from "../../../packages/workflow/src";

export class DiagnosticOutputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DiagnosticOutputError";
  }
}

export function projectDiagnosticRootCauseClaims(
  state: SessionState,
  event: RuntimeEvent,
  specialistName: string,
  evidenceStore: EvidenceStore,
): number {
  if (event.type !== "THREAD_DONE") {
    throw new DiagnosticOutputError("diagnostic output must come from a completed specialist thread");
  }
  const specialist = DIAGNOSTIC_SPECIALISTS.find(
    (candidate) => candidate.name === specialistName,
  );
  if (specialist === undefined) {
    throw new DiagnosticOutputError("diagnostic output came from an unknown specialist");
  }
  const content = readDiagnosticContent(event);
  if (content === undefined) return 0;
  if (content.length > DIAGNOSTIC_OUTPUT_MAX_CHARACTERS) {
    throw new DiagnosticOutputError("diagnostic output exceeded the application character limit");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new DiagnosticOutputError("diagnostic output was not one valid JSON object");
  }
  const output = parseDiagnosticSpecialistOutput(parsed);
  if (output === undefined) {
    throw new DiagnosticOutputError("diagnostic output did not match the causal evidence schema");
  }
  if (output.rootCauseHypotheses.length === 0) return 0;

  const projections = output.rootCauseHypotheses.map((claim, index) =>
    buildDiagnosticProjection(state, event, specialist.id, specialist.name, claim, index),
  );
  for (const projection of projections) {
    const existing = evidenceStore.getEvidence(projection.evidence.id);
    if (
      existing !== undefined &&
      existing.metadata?.causeDigest !== projection.evidence.metadata?.causeDigest
    ) {
      throw new DiagnosticOutputError("diagnostic evidence ID was reused for different causal content");
    }
  }
  for (const projection of projections) {
    if (evidenceStore.getEvidence(projection.evidence.id) === undefined) {
      evidenceStore.recordEvidence(projection.evidence);
    }
  }

  const next = structuredClone(state);
  next.evidenceIds = [
    ...new Set([
      ...next.evidenceIds,
      ...projections.map((projection) => projection.evidence.id),
    ]),
  ];
  for (const projection of projections) {
    const index = next.hypotheses.findIndex(
      (candidate) => candidate.id === projection.hypothesis.id,
    );
    if (index === -1) next.hypotheses.push(projection.hypothesis);
    else next.hypotheses[index] = projection.hypothesis;
  }
  next.version += 1;
  Object.assign(state, new SessionController(next).snapshot());
  return projections.length;
}

export function projectSupportedRootCause(
  state: SessionState,
  event: RuntimeEvent,
  evidenceStore: EvidenceStore,
): boolean {
  if (state.status !== "ACTIVE") return false;
  const criterion = state.successCriteria.find(
    (candidate) => candidate.id === "root-cause-supported",
  );
  const incident = state.successCriteria.find(
    (candidate) => candidate.id === "incident-context",
  );
  const reproduction = state.successCriteria.find(
    (candidate) => candidate.id === "failure-reproduced",
  );
  if (
    criterion === undefined ||
    criterion.status === "PASS" ||
    incident?.status !== "PASS" ||
    reproduction?.status !== "PASS"
  ) {
    return false;
  }

  const incidentEvidenceIds = admissibleEvidenceIds(state, incident, evidenceStore);
  const reproductionEvidenceIds = admissibleEvidenceIds(state, reproduction, evidenceStore);
  if (incidentEvidenceIds.length === 0 || reproductionEvidenceIds.length === 0) {
    return false;
  }

  const candidate = [...state.hypotheses]
    .filter(
      (hypothesis) =>
        hypothesis.status === "SUPPORTED" || hypothesis.status === "CONFIRMED",
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((hypothesis) => ({
      hypothesis,
      evidence: hypothesis.supportingEvidence
        .map((id) => evidenceStore.getEvidence(id))
        .filter(
          (item): item is Evidence =>
            item !== undefined && isCurrentDiagnosticEvidence(item, state, evidenceStore),
        ),
    }))
    .find((entry) => entry.evidence.length > 0);
  if (candidate === undefined) return false;

  const supportingEvidence = [
    ...new Set([
      ...candidate.evidence.map((item) => item.id),
      ...incidentEvidenceIds,
      ...reproductionEvidenceIds,
    ]),
  ];
  const evidenceId = `live-${event.id}-root-cause-supported`;
  const supportingEvidenceDigest = digestCanonical(supportingEvidence);
  const existing = evidenceStore.getEvidence(evidenceId);
  if (
    existing !== undefined &&
    existing.metadata?.supportingEvidenceDigest !== supportingEvidenceDigest
  ) {
    throw new DiagnosticOutputError("root-cause verification evidence was reused for a different subject");
  }
  if (existing === undefined) {
    evidenceStore.recordEvidence(createEvidence({
      id: evidenceId,
      kind: "VERIFICATION",
      sourceEventId: event.id,
      sourceTool: "evidenceforge.root-cause-gate",
      claim:
        `Application validated diagnostic hypothesis ${candidate.hypothesis.id} against exact incident and reproduction evidence`,
      artifactRefs: [
        ...new Set([
          `artifact://${state.task.id}/hypothesis-ledger.json`,
          ...candidate.evidence.flatMap((item) => item.artifactRefs),
        ]),
      ],
      outcome: "PASS",
      binding: artifactBindingFor(state, "INCIDENT"),
      timestamp: event.timestamp,
      metadata: {
        hypothesisId: candidate.hypothesis.id,
        diagnosticEvidenceCount: candidate.evidence.length,
        supportingEvidenceCount: supportingEvidence.length,
        supportingEvidenceDigest,
      },
    }));
  }

  Object.assign(
    state,
    new SessionController(state).upsertHypothesis({
      ...candidate.hypothesis,
      supportingEvidence,
    }),
  );
  Object.assign(
    state,
    new SessionController(state).applyVerification({
      criterionId: criterion.id,
      status: "PASS",
      verifier: criterion.verifier.kind,
      evidenceIds: [evidenceId],
      details:
        `Structured diagnostic cause accepted: ${candidate.hypothesis.statement}`,
      deterministic: true,
      binding: artifactBindingFor(state, criterion.evidenceScope),
    }),
  );
  return true;
}

function buildDiagnosticProjection(
  state: SessionState,
  event: RuntimeEvent,
  specialistId: string,
  specialistName: string,
  claim: DiagnosticRootCauseClaim,
  index: number,
): {
  evidence: Evidence;
  hypothesis: SessionState["hypotheses"][number];
} {
  const evidenceId = `live-${event.id}-diagnostic-root-cause-${index + 1}`;
  const statement = `${claim.cause} Causal mechanism: ${claim.causalMechanism}`;
  const causeDigest = digestCanonical(claim);
  return {
    evidence: createEvidence({
      id: evidenceId,
      kind: "OBSERVATION",
      sourceEventId: event.id,
      sourceTool: `trueforge.dynamic-subagent.${specialistId}`,
      claim: `${specialistName} reported: ${statement}`,
      artifactRefs: [...new Set([
        ...claim.affectedLocations,
        ...claim.evidenceReferences,
      ])],
      outcome: "PASS",
      binding: artifactBindingFor(state, "INCIDENT"),
      timestamp: event.timestamp,
      metadata: {
        schemaVersion: DIAGNOSTIC_OUTPUT_SCHEMA_VERSION,
        specialist: specialistName,
        hypothesisId: claim.id,
        causeDigest,
      },
    }),
    hypothesis: {
      id: `diagnostic-${state.task.id}-${specialistId}-${claim.id}-${event.id}`,
      statement,
      status: claim.status,
      supportingEvidence: [evidenceId],
      contradictingEvidence: [],
    },
  };
}

function admissibleEvidenceIds(
  state: SessionState,
  criterion: SessionState["successCriteria"][number],
  evidenceStore: EvidenceStore,
): string[] {
  const expectedBinding = artifactBindingFor(state, criterion.evidenceScope);
  return criterion.evidenceIds.filter((id) =>
    evidenceStore.isAdmissibleForCriterion(id, criterion, expectedBinding),
  );
}

function isCurrentDiagnosticEvidence(
  evidence: Evidence,
  state: SessionState,
  evidenceStore: EvidenceStore,
): boolean {
  const sourceEvent = evidenceStore.getEvent(evidence.sourceEventId);
  return (
    state.evidenceIds.includes(evidence.id) &&
    evidence.kind === "OBSERVATION" &&
    evidence.outcome === "PASS" &&
    sourceEvent?.type === "THREAD_DONE" &&
    evidence.sourceTool.startsWith("trueforge.dynamic-subagent.") &&
    evidence.metadata?.schemaVersion === DIAGNOSTIC_OUTPUT_SCHEMA_VERSION &&
    typeof evidence.metadata?.causeDigest === "string" &&
    evidence.artifactRefs.length > 0 &&
    artifactBindingMatchesState(evidence.binding, state, "INCIDENT")
  );
}

function readDiagnosticContent(event: RuntimeEvent): string | undefined {
  const payload = asRecord(event.payload);
  const threadState = asRecord(payload.state);
  const output = asRecord(threadState.output);
  const content = output.content;
  return typeof content === "string" ? content : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
