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

const RUNTIME_EVENT_ARTIFACT_PREFIX = "runtime-event://";
const DIAGNOSTIC_EVIDENCE_EVENT_MAX_CHARACTERS = 32_768;

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

  const projections = output.rootCauseHypotheses.map((claim, index) => {
    const resolvedEventIds = resolveDiagnosticEvidenceEventIds(
      evidenceStore,
      event,
      claim.evidenceReferences,
    );
    return buildDiagnosticProjection(
      state,
      event,
      specialist.id,
      specialist.name,
      claim,
      resolvedEventIds,
      index,
    );
  });
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
      status: "SUPPORTED",
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
  resolvedEventIds: string[],
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
      artifactRefs: resolvedEventIds.map(runtimeEventArtifactRef),
      binding: artifactBindingFor(state, "INCIDENT"),
      timestamp: event.timestamp,
      metadata: {
        schemaVersion: DIAGNOSTIC_OUTPUT_SCHEMA_VERSION,
        specialist: specialistName,
        hypothesisId: claim.id,
        reportedStatus: claim.status,
        causeDigest,
        specialistThreadId: event.threadId ?? "",
        resolvedEvidenceCount: resolvedEventIds.length,
        resolvedEvidenceDigest: digestCanonical({
          references: claim.evidenceReferences,
          eventIds: resolvedEventIds,
        }),
      },
    }),
    hypothesis: {
      id: `diagnostic-${state.task.id}-${specialistId}-${claim.id}-${event.id}`,
      statement,
      status: "OPEN",
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
  const resolvedEvents = evidence.artifactRefs.map((artifactRef) =>
    readResolvedDiagnosticEvent(artifactRef, evidenceStore),
  );
  return (
    state.evidenceIds.includes(evidence.id) &&
    evidence.kind === "OBSERVATION" &&
    evidence.outcome === undefined &&
    sourceEvent?.type === "THREAD_DONE" &&
    evidence.sourceTool.startsWith("trueforge.dynamic-subagent.") &&
    evidence.metadata?.schemaVersion === DIAGNOSTIC_OUTPUT_SCHEMA_VERSION &&
    (evidence.metadata?.reportedStatus === "SUPPORTED" ||
      evidence.metadata?.reportedStatus === "CONFIRMED") &&
    typeof evidence.metadata?.causeDigest === "string" &&
    typeof evidence.metadata?.resolvedEvidenceDigest === "string" &&
    evidence.metadata?.resolvedEvidenceCount === evidence.artifactRefs.length &&
    evidence.metadata?.specialistThreadId === sourceEvent.threadId &&
    resolvedEvents.length > 0 &&
    resolvedEvents.every(
      (resolved): resolved is RuntimeEvent =>
        resolved !== undefined &&
        resolved.type === "TOOL_RESULT" &&
        resolved.threadId === sourceEvent.threadId &&
        eventPrecedes(resolved, sourceEvent),
    ) &&
    artifactBindingMatchesState(evidence.binding, state, "INCIDENT")
  );
}

function resolveDiagnosticEvidenceEventIds(
  evidenceStore: EvidenceStore,
  diagnosticEvent: RuntimeEvent,
  references: string[],
): string[] {
  if (diagnosticEvent.threadId === undefined) {
    throw new DiagnosticOutputError("diagnostic output was not bound to a specialist thread");
  }
  const candidates = evidenceStore.listEvents().filter(
    (candidate) =>
      candidate.type === "TOOL_RESULT" &&
      candidate.threadId === diagnosticEvent.threadId &&
      eventPrecedes(candidate, diagnosticEvent),
  );
  const resolvedEventIds: string[] = [];
  for (const reference of references) {
    const resolved = [...candidates].reverse().find((candidate) =>
      eventPayloadContainsReference(candidate, reference),
    );
    if (resolved === undefined) {
      throw new DiagnosticOutputError(
        "diagnostic cause cited evidence that was not observed in its specialist thread",
      );
    }
    if (!resolvedEventIds.includes(resolved.id)) resolvedEventIds.push(resolved.id);
  }
  if (resolvedEventIds.length === 0) {
    throw new DiagnosticOutputError("diagnostic cause did not resolve any recorded tool evidence");
  }
  return resolvedEventIds;
}

function eventPayloadContainsReference(event: RuntimeEvent, reference: string): boolean {
  const serialized = JSON.stringify(event.payload);
  if (serialized.length > DIAGNOSTIC_EVIDENCE_EVENT_MAX_CHARACTERS) return false;
  const payload = asRecord(event.payload);
  const content = payload.content;
  if (typeof content !== "string") return false;
  try {
    const response = asRecord(JSON.parse(content) as unknown);
    if (!diagnosticToolResultIsUsable(response)) return false;
    return collectToolResultStrings(response).some((text) =>
      containsBoundedReference(text, reference),
    );
  } catch {
    return false;
  }
}

function diagnosticToolResultIsUsable(response: Record<string, unknown>): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value: response, depth: 0 },
  ];
  let visited = 0;
  while (pending.length > 0 && visited < 512) {
    const current = pending.pop();
    if (current === undefined) break;
    visited += 1;
    if (current.value === null || typeof current.value !== "object") continue;
    if (
      !Array.isArray(current.value) &&
      recordReportsToolFailure(current.value as Record<string, unknown>)
    ) {
      return false;
    }
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    if (children.length === 0) continue;
    // Evidence is admissible only when the complete result envelope was inspected.
    // Hitting the traversal bound with unseen descendants must fail closed.
    if (current.depth >= 8) return false;
    for (const child of children) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return pending.length === 0;
}

function recordReportsToolFailure(record: Record<string, unknown>): boolean {
  if (record.success === false) return true;
  if (typeof record.exitCode === "number" && record.exitCode !== 0) return true;
  if (typeof record.exit_code === "number" && record.exit_code !== 0) return true;
  return (
    typeof record.status === "string" &&
    ["ERROR", "FAILED", "FAILURE", "DENIED", "TIMEOUT"].includes(
      record.status.toUpperCase(),
    )
  );
}

function containsBoundedReference(text: string, reference: string): boolean {
  let offset = 0;
  while (offset <= text.length - reference.length) {
    const index = text.indexOf(reference, offset);
    if (index === -1) return false;
    const before = index === 0 ? undefined : text[index - 1];
    const afterIndex = index + reference.length;
    const after = afterIndex === text.length ? undefined : text[afterIndex];
    const startsOnBoundary =
      !isReferenceWordCharacter(reference[0]) || !isReferenceWordCharacter(before);
    const endsOnBoundary =
      !isReferenceWordCharacter(reference[reference.length - 1]) ||
      !isReferenceWordCharacter(after);
    if (startsOnBoundary && endsOnBoundary) return true;
    offset = index + 1;
  }
  return false;
}

function isReferenceWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}

function collectToolResultStrings(response: Record<string, unknown>): string[] {
  const strings: string[] = [];
  const pending: Array<{ value: unknown; depth: number }> = [{ value: response, depth: 0 }];
  let visited = 0;
  while (pending.length > 0 && visited < 512) {
    const current = pending.pop();
    if (current === undefined) break;
    visited += 1;
    if (typeof current.value === "string") {
      strings.push(current.value);
      continue;
    }
    if (current.depth >= 8 || current.value === null || typeof current.value !== "object") {
      continue;
    }
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of children) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return strings;
}

function eventPrecedes(candidate: RuntimeEvent, boundary: RuntimeEvent): boolean {
  return (
    typeof candidate.sequenceNumber === "number" &&
    typeof boundary.sequenceNumber === "number" &&
    candidate.sequenceNumber < boundary.sequenceNumber
  );
}

function runtimeEventArtifactRef(eventId: string): string {
  return `${RUNTIME_EVENT_ARTIFACT_PREFIX}${encodeURIComponent(eventId)}`;
}

function readResolvedDiagnosticEvent(
  artifactRef: string,
  evidenceStore: EvidenceStore,
): RuntimeEvent | undefined {
  if (!artifactRef.startsWith(RUNTIME_EVENT_ARTIFACT_PREFIX)) return undefined;
  const encodedEventId = artifactRef.slice(RUNTIME_EVENT_ARTIFACT_PREFIX.length);
  if (encodedEventId.length === 0) return undefined;
  try {
    return evidenceStore.getEvent(decodeURIComponent(encodedEventId));
  } catch {
    return undefined;
  }
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
