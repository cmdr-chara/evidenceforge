import { randomUUID } from "node:crypto";
import {
  digestCanonical,
  OperationRecord,
  OperationSettlement,
  ReplayPolicy,
  RiskLevel,
  SessionState,
} from "../../domain/src";

export interface OperationIntentInput {
  id?: string;
  actionType: string;
  tool: string;
  normalizedArguments: unknown;
  repository: string;
  revision: string;
  risk: RiskLevel;
  replayPolicy: ReplayPolicy;
  expectedEvidence: string[];
  idempotencyKey?: string;
}

export type OperationRecoveryDecision =
  | { action: "EXECUTE" | "REPLAY" | "NEXT"; reason: string }
  | { action: "RECONCILE" | "BLOCK"; reason: string; operationIsUncertain: true };

export function createOperationIntent(
  input: OperationIntentInput,
  now = new Date().toISOString(),
): OperationRecord {
  const normalizedArguments = structuredClone(input.normalizedArguments);
  return {
    id: input.id ?? `operation-${randomUUID()}`,
    actionType: input.actionType,
    tool: input.tool,
    normalizedArguments,
    argumentDigest: digestCanonical(normalizedArguments),
    repository: input.repository,
    revision: input.revision,
    risk: input.risk,
    replayPolicy: input.replayPolicy,
    expectedEvidence: [...input.expectedEvidence],
    idempotencyKey: input.idempotencyKey,
    status: "INTENT_DURABLE",
    intentPersistedAt: now,
  };
}

export function appendOperationIntent(state: SessionState, operation: OperationRecord): void {
  if (state.operations.some((candidate) => candidate.id === operation.id)) {
    throw new Error(`duplicate operation intent: ${operation.id}`);
  }
  if (operation.status !== "INTENT_DURABLE") {
    throw new Error("only a durable intent can be appended");
  }
  state.operations.push(structuredClone(operation));
  state.version += 1;
}

export function markEffectStarted(
  state: SessionState,
  operationId: string,
  now = new Date().toISOString(),
): void {
  const operation = requireOperation(state, operationId);
  if (operation.status !== "INTENT_DURABLE") {
    throw new Error(`operation ${operationId} cannot start from ${operation.status}`);
  }
  operation.status = "EFFECT_STARTED";
  operation.effectStartedAt = now;
  state.version += 1;
}

export function markEffectUncertain(
  state: SessionState,
  operationId: string,
  now = new Date().toISOString(),
): void {
  const operation = requireOperation(state, operationId);
  if (operation.status !== "EFFECT_STARTED" && operation.status !== "SETTLED") {
    throw new Error(`operation ${operationId} cannot become uncertain from ${operation.status}`);
  }
  operation.status = "EFFECT_UNCERTAIN";
  operation.settlement = undefined;
  operation.uncertainAt = now;
  state.version += 1;
}

export function settleOperation(
  state: SessionState,
  operationId: string,
  settlement: OperationSettlement,
): void {
  const operation = requireOperation(state, operationId);
  if (operation.status !== "EFFECT_STARTED" && operation.status !== "EFFECT_UNCERTAIN") {
    throw new Error(`operation ${operationId} cannot settle from ${operation.status}`);
  }
  operation.status = "SETTLED";
  operation.settlement = structuredClone(settlement);
  state.version += 1;
}

export function decideOperationRecovery(operation: OperationRecord): OperationRecoveryDecision {
  if (operation.status === "SETTLED") {
    return { action: "NEXT", reason: "durable settlement identifies the next workflow state" };
  }
  if (operation.status === "INTENT_DURABLE") {
    return { action: "EXECUTE", reason: "the effect definitely did not start" };
  }
  switch (operation.replayPolicy) {
    case "SAFE":
      return { action: "REPLAY", reason: "the interrupted effect is explicitly replay-safe" };
    case "RECONCILE_FIRST":
      return {
        action: "RECONCILE",
        reason: "the effect may have succeeded and authoritative state must be inspected",
        operationIsUncertain: true,
      };
    case "NEVER":
      return {
        action: "BLOCK",
        reason: "automatic repetition is forbidden after uncertain execution",
        operationIsUncertain: true,
      };
  }
}

function requireOperation(state: SessionState, operationId: string): OperationRecord {
  const operation = state.operations.find((candidate) => candidate.id === operationId);
  if (operation === undefined) throw new Error(`unknown operation: ${operationId}`);
  return operation;
}
