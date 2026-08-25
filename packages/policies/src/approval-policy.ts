import { ApprovalRequest } from "../../domain/src/types";

export type ApprovalOutcome =
  | { allowed: true; automatic: boolean }
  | { allowed: false; automatic: boolean; reason: string };

export class ApprovalPolicy {
  public authorize(request: ApprovalRequest): ApprovalOutcome {
    if (request.status === "DENIED") {
      return { allowed: false, automatic: false, reason: "human approval was denied" };
    }
    if (request.risk === "PRIVILEGED" || request.risk === "EXTERNAL_DESTRUCTIVE") {
      return {
        allowed: false,
        automatic: true,
        reason: `${request.risk} is denied by the P0 policy`,
      };
    }
    if (request.risk === "READ_ONLY" || request.risk === "SANDBOX_MUTATION") {
      return { allowed: true, automatic: true };
    }
    if (request.status === "APPROVED") return { allowed: true, automatic: false };
    return {
      allowed: false,
      automatic: false,
      reason: `${request.risk} requires an explicit approval`,
    };
  }
}
