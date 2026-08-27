import { digestCanonical } from "../../domain/src/canonical";
import {
  ArtifactBinding,
  Evidence,
  EvidenceKind,
  RuntimeEvent,
  SuccessCriterion,
} from "../../domain/src/types";

export class EvidenceIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EvidenceIntegrityError";
  }
}

const MODEL_ONLY_SOURCES = new Set(["model", "model.prose", "assistant.message"]);

export interface ModelFacingEvidence {
  evidenceId: string;
  kind: EvidenceKind;
  outcome?: Evidence["outcome"];
  claimSummary: string;
  artifactRefs: string[];
}

export interface ModelFacingEvidenceView {
  items: ModelFacingEvidence[];
  totalAuthoritativeItems: number;
  omittedItems: number;
  truncated: boolean;
}

export class EvidenceStore {
  private readonly events: RuntimeEvent[] = [];
  private readonly eventKeys = new Set<string>();
  private readonly evidence = new Map<string, Evidence>();

  public recordEvent(event: RuntimeEvent): boolean {
    const snapshot = structuredClone(event);
    const key = eventStorageKey(snapshot);
    if (this.eventKeys.has(key)) return false;
    this.eventKeys.add(key);
    this.events.push(snapshot);
    return true;
  }

  public recordEvidence(item: Evidence): void {
    if (this.evidence.has(item.id)) {
      throw new EvidenceIntegrityError(`evidence already exists: ${item.id}`);
    }
    if (this.getEvent(item.sourceEventId) === undefined) {
      throw new EvidenceIntegrityError(
        `evidence ${item.id} references unknown runtime event ${item.sourceEventId}`,
      );
    }
    this.evidence.set(item.id, structuredClone(item));
  }

  public getEvent(id: string): RuntimeEvent | undefined {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index];
      if (event?.id === id) return structuredClone(event);
    }
    return undefined;
  }

  public getEvidence(id: string): Evidence | undefined {
    const item = this.evidence.get(id);
    return item === undefined ? undefined : structuredClone(item);
  }

  public listEvidence(): Evidence[] {
    return [...this.evidence.values()].map((item) => structuredClone(item));
  }

  public listEvents(): RuntimeEvent[] {
    return this.events.map((event) => structuredClone(event));
  }

  public hasEvidence(id: string): boolean {
    return this.evidence.has(id);
  }

  public isAdmissibleForCriterion(
    evidenceId: string,
    criterion: SuccessCriterion,
    expectedBinding?: ArtifactBinding,
  ): boolean {
    const item = this.evidence.get(evidenceId);
    if (item === undefined || item.outcome !== "PASS") return false;

    const event = this.getEvent(item.sourceEventId);
    if (event === undefined || event.type === "MODEL_MESSAGE") return false;
    if (MODEL_ONLY_SOURCES.has(item.sourceTool.toLowerCase())) return false;
    if (expectedBinding !== undefined && !bindingMatches(item.binding, expectedBinding)) return false;

    return admissibleKindsFor(criterion).has(item.kind);
  }

  public criterionHasAdmissibleEvidence(
    criterion: SuccessCriterion,
    expectedBinding?: ArtifactBinding,
  ): boolean {
    return criterion.evidenceIds.some((id) =>
      this.isAdmissibleForCriterion(id, criterion, expectedBinding),
    );
  }

  public export(): { events: RuntimeEvent[]; evidence: Evidence[] } {
    return { events: this.listEvents(), evidence: this.listEvidence() };
  }

  public authoritativeSnapshot(): Readonly<{
    events: RuntimeEvent[];
    evidence: Evidence[];
  }> {
    return deepFreeze(this.export());
  }

  public modelFacingView(
    options: { maxItems: number; maxClaimCharacters: number; maxArtifactRefs?: number },
  ): ModelFacingEvidenceView {
    if (options.maxItems < 0 || options.maxClaimCharacters < 1) {
      throw new Error("model-facing evidence bounds must be non-negative");
    }
    const authoritative = this.listEvidence();
    const selected = authoritative.slice(-options.maxItems);
    const maxArtifacts = options.maxArtifactRefs ?? 3;
    const items = selected.map((item) => ({
      evidenceId: item.id,
      kind: item.kind,
      outcome: item.outcome,
      claimSummary:
        item.claim.length <= options.maxClaimCharacters
          ? item.claim
          : `${item.claim.slice(0, Math.max(0, options.maxClaimCharacters - 1))}…`,
      artifactRefs: item.artifactRefs.slice(0, maxArtifacts),
    }));
    return {
      items,
      totalAuthoritativeItems: authoritative.length,
      omittedItems: authoritative.length - selected.length,
      truncated:
        selected.length !== authoritative.length ||
        selected.some(
          (item) =>
            item.claim.length > options.maxClaimCharacters || item.artifactRefs.length > maxArtifacts,
        ),
    };
  }

  public static restore(snapshot: { events: RuntimeEvent[]; evidence: Evidence[] }): EvidenceStore {
    const store = new EvidenceStore();
    for (const event of snapshot.events) store.recordEvent(event);
    for (const item of snapshot.evidence) store.recordEvidence(item);
    return store;
  }
}

function eventStorageKey(event: RuntimeEvent): string {
  return digestCanonical({
    id: event.id,
    type: event.type,
    source: event.source,
    threadId: event.threadId ?? null,
    sequenceNumber: event.sequenceNumber ?? null,
    payload: event.payload,
  });
}

function bindingMatches(
  actual: ArtifactBinding | undefined,
  expected: ArtifactBinding,
): boolean {
  if (actual === undefined) return false;
  return (
    actual.taskId === expected.taskId &&
    actual.repository === expected.repository &&
    actual.revision === expected.revision &&
    actual.successContractDigest === expected.successContractDigest &&
    actual.scope === expected.scope &&
    actual.patchDigest === expected.patchDigest &&
    Number.isInteger(actual.stateVersion) &&
    actual.stateVersion >= 1 &&
    actual.stateVersion <= expected.stateVersion
  );
}

function admissibleKindsFor(criterion: SuccessCriterion): Set<EvidenceKind> {
  switch (criterion.verifier.kind) {
    case "FAILURE_SIGNATURE":
      return new Set(["REPRODUCTION"]);
    case "COMMAND":
      return criterion.verifier.purpose === "REPRODUCTION"
        ? new Set(["REPRODUCTION"])
        : new Set(["VERIFICATION"]);
    case "DIFF_INTEGRITY":
    case "SCHEMA_FILE":
      return new Set(["VERIFICATION"]);
    case "REVIEWER":
      return new Set(["REVIEW"]);
    case "EXTERNAL_STATE":
      return new Set(["EXTERNAL_RESULT"]);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
