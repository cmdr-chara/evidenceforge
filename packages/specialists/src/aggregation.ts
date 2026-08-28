import { AgentResult, Hypothesis } from "../../domain/src/types";
import { EvidenceStore } from "../../evidence/src";
import { DIAGNOSTIC_SPECIALISTS, assertDiagnosticTopology } from "./definitions";

export interface AggregatedInvestigation {
  findings: string[];
  hypotheses: Hypothesis[];
  evidenceIds: string[];
  unresolvedQuestions: string[];
  missingAgents: string[];
}

export class SpecialistAggregator {
  public constructor(private readonly evidenceStore: EvidenceStore) {
    assertDiagnosticTopology(DIAGNOSTIC_SPECIALISTS);
  }

  public aggregate(results: AgentResult[]): AggregatedInvestigation {
    const expected = new Set(DIAGNOSTIC_SPECIALISTS.map((definition) => definition.name));
    for (const result of results) {
      if (!expected.has(result.agent)) throw new Error(`unexpected diagnostic specialist: ${result.agent}`);
      for (const evidenceId of result.evidenceIds) {
        if (!this.evidenceStore.hasEvidence(evidenceId)) {
          throw new Error(`${result.agent} references unknown evidence ${evidenceId}`);
        }
      }
    }
    const hypotheses = mergeHypotheses(results.flatMap((result) => result.hypotheses), results);
    return {
      findings: unique(results.flatMap((result) => result.findings)),
      hypotheses,
      evidenceIds: unique(results.flatMap((result) => result.evidenceIds)),
      unresolvedQuestions: unique(results.flatMap((result) => result.unresolvedQuestions)),
      missingAgents: [...expected].filter((name) => !results.some((result) => result.agent === name)),
    };
  }
}

function mergeHypotheses(statements: string[], results: AgentResult[]): Hypothesis[] {
  return unique(statements).map((statement, index) => {
    const supportingEvidence = unique(
      results.filter((result) => result.hypotheses.includes(statement)).flatMap((result) => result.evidenceIds),
    );
    return {
      id: `H${index + 1}`,
      statement,
      status: supportingEvidence.length >= 2 ? "SUPPORTED" : "OPEN",
      supportingEvidence,
      contradictingEvidence: [],
    };
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
