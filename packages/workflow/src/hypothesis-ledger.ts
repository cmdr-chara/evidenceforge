import { Hypothesis } from "../../domain/src/types";
import { EvidenceStore } from "../../evidence/src";

export class HypothesisLedger {
  private readonly hypotheses = new Map<string, Hypothesis>();

  public constructor(private readonly evidenceStore: EvidenceStore) {}

  public open(id: string, statement: string): Hypothesis {
    if (this.hypotheses.has(id)) throw new Error(`hypothesis already exists: ${id}`);
    const hypothesis: Hypothesis = {
      id,
      statement,
      status: "OPEN",
      supportingEvidence: [],
      contradictingEvidence: [],
    };
    this.hypotheses.set(id, hypothesis);
    return structuredClone(hypothesis);
  }

  public support(id: string, evidenceIds: string[]): Hypothesis {
    const hypothesis = this.require(id);
    this.assertEvidence(evidenceIds);
    hypothesis.supportingEvidence = unique([...hypothesis.supportingEvidence, ...evidenceIds]);
    hypothesis.status = "SUPPORTED";
    return structuredClone(hypothesis);
  }

  public refute(id: string, evidenceIds: string[]): Hypothesis {
    const hypothesis = this.require(id);
    this.assertEvidence(evidenceIds);
    hypothesis.contradictingEvidence = unique([...hypothesis.contradictingEvidence, ...evidenceIds]);
    hypothesis.status = "REFUTED";
    return structuredClone(hypothesis);
  }

  public confirm(id: string, evidenceIds: string[]): Hypothesis {
    const hypothesis = this.require(id);
    this.assertEvidence(evidenceIds);
    hypothesis.supportingEvidence = unique([...hypothesis.supportingEvidence, ...evidenceIds]);
    hypothesis.status = "CONFIRMED";
    return structuredClone(hypothesis);
  }

  public list(): Hypothesis[] {
    return [...this.hypotheses.values()].map((item) => structuredClone(item));
  }

  private require(id: string): Hypothesis {
    const hypothesis = this.hypotheses.get(id);
    if (hypothesis === undefined) throw new Error(`unknown hypothesis: ${id}`);
    return hypothesis;
  }

  private assertEvidence(ids: string[]): void {
    if (ids.length === 0) throw new Error("hypothesis status changes require evidence");
    for (const id of ids) {
      if (!this.evidenceStore.hasEvidence(id)) throw new Error(`unknown evidence: ${id}`);
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
