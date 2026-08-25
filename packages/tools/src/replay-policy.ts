import { ReplayPolicy, RiskLevel } from "../../domain/src";

export interface ToolActionMetadata {
  tool: string;
  risk: RiskLevel;
  replayPolicy: ReplayPolicy;
}

export function toolActionMetadata(tool: string, risk: RiskLevel): ToolActionMetadata {
  return { tool, risk, replayPolicy: replayPolicyForRisk(risk) };
}

export function replayPolicyForRisk(risk: RiskLevel): ReplayPolicy {
  switch (risk) {
    case "READ_ONLY":
      return "SAFE";
    case "EXTERNAL_REVERSIBLE":
      return "RECONCILE_FIRST";
    case "SANDBOX_MUTATION":
    case "EXTERNAL_DESTRUCTIVE":
    case "PRIVILEGED":
    case "UNKNOWN":
      return "NEVER";
  }
}
