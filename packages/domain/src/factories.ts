import { randomUUID } from "node:crypto";
import { Plan, SessionState, SuccessCriterion, Task } from "./types";
import { validateSessionState, validateTask } from "./validation";

export interface CreateTaskInput {
  objective: string;
  repository: string;
  revision: string;
  runId: string;
  constraints?: string[];
  id?: string;
  createdAt?: string;
}

export function createTask(input: CreateTaskInput): Task {
  return validateTask({
    id: input.id ?? `task-${randomUUID()}`,
    objective: input.objective,
    source: { kind: "GITHUB_ACTIONS", runId: input.runId },
    repository: input.repository,
    revision: input.revision,
    constraints: [...(input.constraints ?? [])],
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}

export function createSessionState(
  task: Task,
  successCriteria: SuccessCriterion[],
  plan?: Plan,
): SessionState {
  return validateSessionState({
    version: 1,
    task,
    phase: "INTAKE",
    plan: plan ?? { version: 1, steps: [] },
    successCriteria: successCriteria.map((criterion) => ({
      ...criterion,
      evidenceIds: [...criterion.evidenceIds],
    })),
    hypotheses: [],
    evidenceIds: [],
    approvals: [],
    verifierResults: [],
    operations: [],
    roundEvaluations: [],
    toolAttempts: [],
    patchAttempts: 0,
    replanAttempts: 0,
    transientAttempts: 0,
    status: "ACTIVE",
    traceId: `trace-${randomUUID()}`,
  });
}

export function pendingCriterion(
  id: string,
  description: string,
  verifier: SuccessCriterion["verifier"],
  required = true,
): SuccessCriterion {
  return {
    id,
    description,
    required,
    verifier,
    status: "PENDING",
    evidenceIds: [],
  };
}
