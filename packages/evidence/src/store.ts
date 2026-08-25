import {
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
  private readonly events = new Map<string, RuntimeEvent>();
  private readonly evidence = new Map<string, Evidence>();

  public recordEvent(event: RuntimeEvent): void {
    if (this.events.has(event.id)) {
      throw new EvidenceIntegrityError(`runtime event already exists: ${event.id}`);
    }
    this.events.set(event.id, structuredClone(event));
  }

  public recordEvidence(item: Evidence): void {
    if (this.evidence.has(item.id)) {
      throw new EvidenceIntegrityError(`evidence already exists: ${item.id}`);
    }
    if (!this.events.has(item.sourceEventId)) {
      throw new EvidenceIntegrityError(
        `evidence ${item.id} references unknown runtime event ${item.sourceEventId}`,
      );
    }
    this.evidence.set(item.id, structuredClone(item));
  }

  public getEvent(id: string): RuntimeEvent | undefined {
    const event = this.events.get(id);
    return event === undefined ? undefined : structuredClone(event);
  }

  public getEvidence(id: string): Evidence | undefined {
    const item = this.evidence.get(id);
    return item === undefined ? undefined : structuredClone(item);
  }

  public listEvidence(): Evidence[] {
    return [...this.evidence.values()].map((item) => structuredClone(item));
  }

  public listEvents(): RuntimeEvent[] {
    return [...this.events.values()].map((event) => structuredClone(event));
  }

  public hasEvidence(id: string): boolean {
    return this.evidence.has(id);
  }

  public isAdmissibleForCriterion(evidenceId: string, criterion: SuccessCriterion): boolean {
    const item = this.evidence.get(evidenceId);
    if (item === undefined || item.outcome !== "PASS") return false;

    const event = this.events.get(item.sourceEventId);
    if (event === undefined || event.type === "MODEL_MESSAGE") return false;
    if (MODEL_ONLY_SOURCES.has(item.sourceTool.toLowerCase())) return false;

    return admissibleKindsFor(criterion).has(item.kind);
  }

  public criterionHasAdmissibleEvidence(criterion: SuccessCriterion): boolean {
    return criterion.evidenceIds.some((id) => this.isAdmissibleForCriterion(id, criterion));
  }

  public export(): { events: RuntimeEvent[]; evidence: Evidence[] } {
    return { events: this.listEvents(), evidence: this.listEvidence() };
  }

  public authoritativeSnapshot(): Readonly<{
    events: RuntimeEvent[];
    evidence: Evidence[];
  }> {
    return Object.freeze(this.export());
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
