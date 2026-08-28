import { RiskLevel } from "../../domain/src/types";

export interface ToolRiskContext {
  tool: string;
  arguments: unknown;
  mcpAnnotations?: Record<string, unknown>;
}

export interface RiskDecision {
  risk: RiskLevel;
  requiresApproval: boolean;
  deniedByDefault: boolean;
  reason: string;
  annotationsObserved: boolean;
}

const READ_ONLY = [
  /^github\.(get|list|search|fetch|read|inspect|download)/i,
  /^github-mcp\.(get|list|search|fetch|read|inspect)/i,
  /^evidenceforge\.(search_logs|search_repository|get_incident_context)$/i,
];

const SANDBOX_MUTATION = [
  /^sandbox\.(write|edit|run|exec|patch|install)/i,
  /^daytona\.(write|edit|run|exec|patch|install)/i,
];

const EXTERNAL_REVERSIBLE = [
  /^github\.(create_pull_request|create_comment|create_branch)/i,
  /^github-mcp\.(create_pull_request|create_comment|create_branch)/i,
];

const EXTERNAL_DESTRUCTIVE = [
  /^github\.(merge|delete|close_repository|force_push)/i,
  /^github-mcp\.(merge|delete|force_push)/i,
  /deploy/i,
];

const PRIVILEGED = [/secret/i, /credential/i, /admin/i, /sudo/i, /token\.read/i];

export class RiskPolicy {
  public classify(context: ToolRiskContext): RiskDecision {
    const annotationsObserved = context.mcpAnnotations !== undefined;
    const risk = classifyByTrustedRegistry(context.tool);
    switch (risk) {
      case "READ_ONLY":
      case "SANDBOX_MUTATION":
        return {
          risk,
          requiresApproval: false,
          deniedByDefault: false,
          reason: `${risk} action is automatic within its bounded execution context`,
          annotationsObserved,
        };
      case "EXTERNAL_REVERSIBLE":
        return {
          risk,
          requiresApproval: true,
          deniedByDefault: false,
          reason: "externally visible reversible writes require human approval",
          annotationsObserved,
        };
      case "EXTERNAL_DESTRUCTIVE":
        return {
          risk,
          requiresApproval: true,
          deniedByDefault: true,
          reason: "destructive external actions are outside the P0 autonomous policy",
          annotationsObserved,
        };
      case "PRIVILEGED":
        return {
          risk,
          requiresApproval: true,
          deniedByDefault: true,
          reason: "privileged operations are denied by default",
          annotationsObserved,
        };
      case "UNKNOWN":
        return {
          risk,
          requiresApproval: true,
          deniedByDefault: false,
          reason: "unclassified actions require approval; MCP annotations are hints only",
          annotationsObserved,
        };
    }
  }
}

function classifyByTrustedRegistry(tool: string): RiskLevel {
  if (PRIVILEGED.some((pattern) => pattern.test(tool))) return "PRIVILEGED";
  if (EXTERNAL_DESTRUCTIVE.some((pattern) => pattern.test(tool))) return "EXTERNAL_DESTRUCTIVE";
  if (EXTERNAL_REVERSIBLE.some((pattern) => pattern.test(tool))) return "EXTERNAL_REVERSIBLE";
  if (READ_ONLY.some((pattern) => pattern.test(tool))) return "READ_ONLY";
  if (SANDBOX_MUTATION.some((pattern) => pattern.test(tool))) return "SANDBOX_MUTATION";
  return "UNKNOWN";
}
