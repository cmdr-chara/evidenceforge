import { CompletionCertificateData, NextWorkflowAction, SessionState } from "../../domain/src";
import { EvidenceStore } from "../../evidence/src";
import { CompletionGate } from "./completion-gate";
import { ProgressEvaluator } from "./progress-evaluator";

export type StopGuardDecision =
  | { successful: true; action: "COMPLETE"; certificate: CompletionCertificateData }
  | { successful: false; action: Exclude<NextWorkflowAction, "COMPLETE_CANDIDATE">; reasons: string[] };

export class StopGuard {
  public constructor(private readonly evidenceStore: EvidenceStore) {}

  public evaluateNaturalStop(state: SessionState): StopGuardDecision {
    const round = new ProgressEvaluator(this.evidenceStore).evaluate(state, "VERIFICATION");
    const gate = new CompletionGate(this.evidenceStore).evaluate(state);
    if (round.nextAction === "COMPLETE_CANDIDATE" && gate.allowed) {
      return { successful: true, action: "COMPLETE", certificate: gate.certificate };
    }
    const action = round.nextAction === "COMPLETE_CANDIDATE" ? "BLOCK" : round.nextAction;
    return {
      successful: false,
      action,
      reasons: gate.allowed ? round.missingEvidence : gate.failures.map((failure) => failure.message),
    };
  }
}
