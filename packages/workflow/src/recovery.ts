import { WorkflowPhase } from "../../domain/src/types";

export type FailureClass =
  | "TRANSIENT"
  | "INPUT_ERROR"
  | "SEMANTIC_FAILURE"
  | "POLICY_DENIED"
  | "ENVIRONMENT_FAILURE"
  | "BUDGET_EXHAUSTED"
  | "NO_PROGRESS";

export interface RecoveryBudget {
  transientAttempts: number;
  patchAttempts: number;
  replanAttempts: number;
}

export interface RecoveryDecision {
  action: "RETRY" | "CORRECT_INPUT" | "REPLAN" | "RECOVER_ENVIRONMENT" | "BLOCK" | "ESCALATE";
  nextPhase: WorkflowPhase;
  delayMs?: number;
  reason: string;
  budget: RecoveryBudget;
}

export class RecoveryPlanner {
  public constructor(
    private readonly maxTransientRetries = 2,
    private readonly maxPatchAttempts = 2,
    private readonly maxMajorReplans = 2,
  ) {}

  public decide(failure: FailureClass, budget: RecoveryBudget): RecoveryDecision {
    const next = { ...budget };
    switch (failure) {
      case "TRANSIENT":
        if (next.transientAttempts >= this.maxTransientRetries) {
          return this.escalate(next, "transient retry budget exhausted");
        }
        next.transientAttempts += 1;
        return {
          action: "RETRY",
          nextPhase: "RETRYING",
          delayMs: 250 * 2 ** (next.transientAttempts - 1) + 37 * next.transientAttempts,
          reason: "bounded exponential backoff with deterministic jitter",
          budget: next,
        };
      case "INPUT_ERROR":
        return {
          action: "CORRECT_INPUT",
          nextPhase: "RETRYING",
          reason: "correct the structured input; do not repeat unchanged",
          budget: next,
        };
      case "SEMANTIC_FAILURE":
        if (next.patchAttempts >= this.maxPatchAttempts || next.replanAttempts >= this.maxMajorReplans) {
          return this.escalate(next, "semantic failure budget exhausted");
        }
        next.patchAttempts += 1;
        next.replanAttempts += 1;
        return {
          action: "REPLAN",
          nextPhase: "REPLANNING",
          reason: "a validly executed verifier failed; reconsider the hypothesis and patch",
          budget: next,
        };
      case "POLICY_DENIED":
        return {
          action: "BLOCK",
          nextPhase: "BLOCKED",
          reason: "approval was denied and no safe alternative is proven",
          budget: next,
        };
      case "ENVIRONMENT_FAILURE":
        if (next.transientAttempts >= this.maxTransientRetries) {
          return this.escalate(next, "environment recovery budget exhausted");
        }
        next.transientAttempts += 1;
        return {
          action: "RECOVER_ENVIRONMENT",
          nextPhase: "RETRYING",
          reason: "recreate sandbox at exact revision and restore the known patch artifact",
          budget: next,
        };
      case "BUDGET_EXHAUSTED":
        return this.escalate(next, "overall iteration budget exhausted");
      case "NO_PROGRESS":
        if (next.replanAttempts >= this.maxMajorReplans) {
          return this.escalate(next, "no-progress replan budget exhausted");
        }
        next.replanAttempts += 1;
        return {
          action: "REPLAN",
          nextPhase: "REPLANNING",
          reason: "equivalent attempts produced no new evidence or state; change the plan",
          budget: next,
        };
    }
  }

  private escalate(budget: RecoveryBudget, reason: string): RecoveryDecision {
    return { action: "ESCALATE", nextPhase: "ESCALATED", reason, budget };
  }
}
