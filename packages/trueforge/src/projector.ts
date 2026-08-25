import {
  ApprovalRequest,
  RuntimeEvent,
  SessionState,
  ToolResult,
} from "../../domain/src/types";
import { RiskPolicy } from "../../policies/src";
import { TrueForgeEventIndex } from "./event-index";

export interface RuntimeProjection {
  toolResult?: ToolResult;
  approvalIds: string[];
  error?: string;
}

export class TrueForgeEventProjector {
  private readonly eventIndex = new TrueForgeEventIndex();

  public constructor(private readonly riskPolicy = new RiskPolicy()) {}

  public project(state: SessionState, event: RuntimeEvent): RuntimeProjection {
    this.eventIndex.ingest(event.payload);

    if (event.type === "TURN_CREATED" && state.phase === "INTAKE") {
      state.phase = "DEFINE_SUCCESS";
      state.version += 1;
    }

    if (event.type === "TOOL_RESULT") {
      try {
        return {
          toolResult: this.eventIndex.toolResultFrom(event.payload),
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
