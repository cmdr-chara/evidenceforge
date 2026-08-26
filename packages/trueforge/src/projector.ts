import {
  ApprovalRequest,
  RuntimeEvent,
  SessionState,
  ToolResult,
  VerificationResult,
} from "../../domain/src/types";
import { digestCanonical } from "../../domain/src/canonical";
import { EvidenceStore } from "../../evidence/src";
import { RiskPolicy } from "../../policies/src";
import { replayPolicyForRisk } from "../../tools/src";
import {
  appendOperationIntent,
  createOperationIntent,
  settleOperation,
} from "../../workflow/src";
import { TrueForgeEventIndex } from "./event-index";
import { TrueForgeVerifierProjector } from "./verifier-projection";

export interface RuntimeProjection {
  toolResult?: ToolResult;
  verificationResult?: VerificationResult;
  verifierRejection?: string;
  approvalIds: string[];
  error?: string;
}

export class TrueForgeEventProjector {
  private readonly eventIndex = new TrueForgeEventIndex();
  private readonly verifierProjector?: TrueForgeVerifierProjector;

  public constructor(
    private readonly riskPolicy = new RiskPolicy(),
    evidenceStore?: EvidenceStore,
  ) {
    this.verifierProjector =
      evidenceStore === undefined ? undefined : new TrueForgeVerifierProjector(evidenceStore);
  }

  public registerApprovalToolCall(approval: ApprovalRequest): void {
    if (approval.toolCallId === undefined || approval.threadId === undefined) {
      throw new Error("approval is missing its TrueForge tool-call correlation");
    }
    const { serverName, name } = splitToolName(approval.action);
    this.eventIndex.registerToolCall({
      id: approval.toolCallId,
      sourceEventId: approval.id,
      threadId: approval.threadId,
      name,
      arguments: JSON.stringify(approval.normalizedArguments),
      toolType: serverName === undefined ? undefined : "mcp",
      serverName,
    });
  }

  public project(state: SessionState, event: RuntimeEvent): RuntimeProjection {
    this.eventIndex.ingest(event.payload);

    if (event.type === "TURN_CREATED" && state.phase === "INTAKE") {
      state.phase = "DEFINE_SUCCESS";
      state.version += 1;
    }

    if (event.type === "TURN_DONE") {
      const payload = asRecord(event.payload);
      const turnState = asRecord(payload.state);
      const turnStatus = readString(turnState, "status");
      if (turnStatus === "cancelled" || turnStatus === "failed") {
        const reason = readString(turnState, "reason");
        block(
          state,
          reason === "server-execution-timeout"
            ? "TrueForge turn exceeded the server execution timeout"
            : `TrueForge turn ended with status ${turnStatus}`,
        );
      }
    }

    if (event.type === "TOOL_RESULT") {
      try {
        const toolResult = this.eventIndex.toolResultFrom(event.payload);
        const toolCall = this.eventIndex.getToolCall(toolResult.callId);
        if (toolCall === undefined) {
          throw new Error(`correlated tool call ${toolResult.callId} disappeared from the index`);
        }
        const verification = this.verifierProjector?.project(state, toolCall, toolResult);
        const approval = state.approvals.find((candidate) => candidate.toolCallId === toolCall.id);
        const operation = state.operations.find(
          (candidate) => candidate.id === approval?.provenance?.originatingOperationId,
        );
        if (
          operation !== undefined &&
          (operation.status === "EFFECT_STARTED" || operation.status === "EFFECT_UNCERTAIN")
        ) {
          settleOperation(state, operation.id, {
            authoritativeResult: structuredClone(toolResult),
            runtimeEventId: event.id,
            evidenceIds: [...toolResult.evidenceIds],
            nextWorkflowState: state.phase,
            settledAt: event.timestamp,
          });
        }
        return {
          toolResult,
          verificationResult: verification?.result,
          verifierRejection: verification?.rejection,
          approvalIds: [],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        block(state, `TrueForge tool result could not be correlated: ${message}`);
        return { approvalIds: [], error: message };
      }
    }

    if (event.type === "APPROVAL") {
      try {
        const indexed = this.eventIndex.approvalFrom(event.payload);
        const approvalIds: string[] = [];
        let deniedByPolicy = false;

        for (const call of indexed.toolCalls) {
          const id = `approval-${event.id}-${call.id}`;
          if (state.approvals.some((approval) => approval.id === id)) continue;
          const tool = call.serverName === undefined ? call.name : `${call.serverName}.${call.name}`;
          const normalizedArguments = parseArguments(call.arguments);
          const decision = this.riskPolicy.classify({
            tool,
            arguments: normalizedArguments,
          });
          const operationId = `operation-${event.id}-${call.id}`;
          const operation = createOperationIntent(
            {
              id: operationId,
              actionType: tool,
              tool,
              normalizedArguments,
              repository: state.task.repository,
              revision: state.task.revision,
              risk: decision.risk,
              replayPolicy: replayPolicyForRisk(decision.risk),
              expectedEvidence: [`runtime-event:${call.id}`],
              idempotencyKey: call.id,
            },
            event.timestamp,
          );
          if (!state.operations.some((candidate) => candidate.id === operationId)) {
            appendOperationIntent(state, operation);
          }
          const approval: ApprovalRequest = {
            id,
            action: tool,
            normalizedArguments,
            risk: decision.risk,
            reason: decision.reason,
            reversible: decision.risk === "EXTERNAL_REVERSIBLE",
            status: decision.deniedByDefault ? "DENIED" : "PENDING",
            toolCallId: call.id,
            threadId: indexed.threadId,
            provenance: {
              actionDigest: digestCanonical(normalizedArguments),
              repository: state.task.repository,
              revision: state.task.revision,
              risk: decision.risk,
              originatingOperationId: operationId,
              issuedAt: event.timestamp,
              expiresAt: new Date(Date.parse(event.timestamp) + 15 * 60 * 1_000).toISOString(),
            },
          };
          state.approvals.push(approval);
          state.version += 1;
          approvalIds.push(id);
          deniedByPolicy ||= decision.deniedByDefault;
        }

        if (deniedByPolicy) {
          block(state, "TrueForge requested a privileged or destructive action denied by policy");
        } else if (
          approvalIds.length > 0 &&
          state.phase === "REVIEWING" &&
          state.approvals.some((approval) =>
            approvalIds.includes(approval.id) && approval.status === "PENDING",
          )
        ) {
          state.phase = "AWAITING_APPROVAL";
          state.version += 1;
        }
        return { approvalIds };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        block(state, `TrueForge approval could not be correlated: ${message}`);
        return { approvalIds: [], error: message };
      }
    }

    if (event.type === "AUTH_REQUIRED") {
      block(state, "TrueForge requires external authentication before the workflow can continue");
    }

    return { approvalIds: [] };
  }
}

function splitToolName(action: string): { serverName?: string; name: string } {
  const separator = action.indexOf(".");
  if (separator <= 0 || separator === action.length - 1) return { name: action };
  return {
    serverName: action.slice(0, separator),
    name: action.slice(separator + 1),
  };
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { raw: value, malformed: true };
  }
}

function block(state: SessionState, reason: string): void {
  if (state.status !== "ACTIVE") return;
  state.phase = "BLOCKED";
  state.status = "BLOCKED";
  state.blockedReason = reason;
  state.version += 1;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
