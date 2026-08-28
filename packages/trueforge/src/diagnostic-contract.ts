import { RuntimeEvent, SessionState } from "../../domain/src";
import { TRUEFORGE_SPECIALIST_TOOL_BUDGET } from "./agent-spec";

export const REQUIRED_DIAGNOSTIC_SPECIALISTS = [
  "Repository Investigator",
  "Failure / Log Investigator",
  "Dependency / Configuration Investigator",
] as const;

export const INDEPENDENT_REVIEWER_NAME = "Independent Patch Reviewer";

export interface DiagnosticContractViolation {
  code:
    | "UNEXPECTED_SPECIALIST"
    | "DUPLICATE_SPECIALIST"
    | "INVALID_PARENT"
    | "UNKNOWN_SPECIALIST_THREAD"
    | "FAILED_SPECIALIST"
    | "TOOL_BUDGET_EXCEEDED"
    | "INCOMPLETE_FAN_OUT"
    | "INVALID_TURN_ORDER"
    | "MALFORMED_EVENT"
    | "NON_PARALLEL_FAN_OUT";
  reason: string;
}

export class DiagnosticContractGuard {
  private turnCount = 0;
  private turnOpen = false;
  private requiredTurn = false;
  private readonly specialists = new Map<string, string>();
  private readonly observedNames = new Set<string>();
  private readonly completedThreads = new Set<string>();
  private readonly toolResults = new Map<string, number>();
  private reviewThreadId: string | undefined;
  private violation: DiagnosticContractViolation | undefined;

  public constructor(events: RuntimeEvent[] = []) {
    for (const event of events) this.observe(event);
  }

  public observe(event: RuntimeEvent): DiagnosticContractViolation | undefined {
    if (this.violation !== undefined) return this.violation;
    if (event.type === "TURN_CREATED") {
      if (this.turnOpen) {
        return this.fail(
          "INVALID_TURN_ORDER",
          "TrueForge started a new turn before the active turn ended",
        );
      }
      this.turnCount += 1;
      this.requiredTurn = this.turnCount === 1;
      this.turnOpen = true;
      this.resetTurn();
      return undefined;
    }

    if (event.type === "TURN_DONE" && !this.turnOpen) {
      return this.fail(
        "INVALID_TURN_ORDER",
        "TrueForge ended a turn that was never started",
      );
    }

    if (event.type === "THREAD_CREATED") {
      if (!this.turnOpen || !this.requiredTurn) {
        return this.fail(
          "DUPLICATE_SPECIALIST",
          "TrueForge created a diagnostic specialist outside the initial fan-out",
        );
      }
      const payload = asRecord(event.payload);
      const parent = asRecord(payload.parent);
      const parentThreadId = readString(parent, "threadId") ?? readString(parent, "thread_id");
      const agentInfo = asRecord(payload.agentInfo ?? payload.agent_info);
      const agentType = readString(agentInfo, "type");
      const name = readString(agentInfo, "name");
      const parentToolCallId =
        readString(parent, "toolCallId") ?? readString(parent, "tool_call_id");
      const threadId =
        event.threadId ?? readString(payload, "threadId") ?? readString(payload, "thread_id");

      if (name === INDEPENDENT_REVIEWER_NAME) {
        if (
          parentThreadId !== "main" ||
          agentType !== "dynamic" ||
          threadId === undefined ||
          parentToolCallId === undefined ||
          this.reviewThreadId !== undefined ||
          this.specialists.size !== REQUIRED_DIAGNOSTIC_SPECIALISTS.length ||
          [...this.specialists.keys()].some((id) => !this.completedThreads.has(id))
        ) {
          return this.fail(
            "UNEXPECTED_SPECIALIST",
            "TrueForge created the independent reviewer before diagnostics completed or with invalid identity",
          );
        }
        this.reviewThreadId = threadId;
        return undefined;
      }

      if (parentThreadId !== "main") {
        return this.fail(
          "INVALID_PARENT",
          "TrueForge diagnostic fan-out created a non-supervisor child thread",
        );
      }
      if (
        name === undefined ||
        name.trim().length === 0 ||
        agentType !== "dynamic" ||
        threadId === undefined ||
        threadId.trim().length === 0 ||
        parentToolCallId === undefined ||
        parentToolCallId.trim().length === 0 ||
        !REQUIRED_DIAGNOSTIC_SPECIALISTS.includes(
          name as (typeof REQUIRED_DIAGNOSTIC_SPECIALISTS)[number],
        )
      ) {
        return this.fail(
          "UNEXPECTED_SPECIALIST",
          "TrueForge diagnostic fan-out created an unexpected specialist",
        );
      }
      if (this.observedNames.has(name) || this.specialists.has(threadId)) {
        return this.fail(
          "DUPLICATE_SPECIALIST",
          "TrueForge diagnostic fan-out created a duplicate specialist",
        );
      }
      this.observedNames.add(name);
      this.specialists.set(threadId, name);
      return undefined;
    }

    if (!this.requiredTurn) return undefined;

    if (event.type === "TOOL_RESULT") {
      if (event.threadId === undefined) {
        return this.fail(
          "MALFORMED_EVENT",
          "TrueForge emitted a tool result without a diagnostic thread ID",
        );
      }
      if (event.threadId === "main") return undefined;
      if (event.threadId === this.reviewThreadId) {
        const count = (this.toolResults.get(event.threadId) ?? 0) + 1;
        this.toolResults.set(event.threadId, count);
        if (count > TRUEFORGE_SPECIALIST_TOOL_BUDGET) {
          return this.fail(
            "TOOL_BUDGET_EXCEEDED",
            `TrueForge independent reviewer exceeded the ${TRUEFORGE_SPECIALIST_TOOL_BUDGET}-tool budget`,
          );
        }
        return undefined;
      }
      if (!this.specialists.has(event.threadId)) {
        return this.fail(
          "UNKNOWN_SPECIALIST_THREAD",
          "TrueForge emitted a tool result for an unknown diagnostic thread",
        );
      }
      if (this.specialists.size !== REQUIRED_DIAGNOSTIC_SPECIALISTS.length) {
        return this.fail(
          "NON_PARALLEL_FAN_OUT",
          "TrueForge began specialist work before the three-way fan-out was created",
        );
      }
      const count = (this.toolResults.get(event.threadId) ?? 0) + 1;
      this.toolResults.set(event.threadId, count);
      if (count > TRUEFORGE_SPECIALIST_TOOL_BUDGET) {
        return this.fail(
          "TOOL_BUDGET_EXCEEDED",
          `TrueForge diagnostic specialist exceeded the ${TRUEFORGE_SPECIALIST_TOOL_BUDGET}-tool budget`,
        );
      }
      return undefined;
    }

    if (event.type === "THREAD_DONE") {
      if (event.threadId === undefined) {
        return this.fail(
          "MALFORMED_EVENT",
          "TrueForge completed a diagnostic thread without a thread ID",
        );
      }
      if (event.threadId === this.reviewThreadId) {
        const status = readString(asRecord(asRecord(event.payload).state), "status");
        if (status !== "done") {
          return this.fail(
            "FAILED_SPECIALIST",
            "TrueForge independent reviewer did not complete successfully",
          );
        }
        return undefined;
      }
      if (!this.specialists.has(event.threadId)) {
        return this.fail(
          "UNKNOWN_SPECIALIST_THREAD",
          "TrueForge completed an unknown diagnostic thread",
        );
      }
      if (this.specialists.size !== REQUIRED_DIAGNOSTIC_SPECIALISTS.length) {
        return this.fail(
          "NON_PARALLEL_FAN_OUT",
          "TrueForge completed a specialist before the three-way fan-out was created",
        );
      }
      const status = readString(asRecord(asRecord(event.payload).state), "status");
      if (status !== "done") {
        return this.fail(
          "FAILED_SPECIALIST",
          "TrueForge diagnostic specialist did not complete successfully",
        );
      }
      this.completedThreads.add(event.threadId);
      return undefined;
    }

    if (event.type === "TURN_DONE" && terminalStatus(event) === "done") {
      if (
        this.specialists.size !== REQUIRED_DIAGNOSTIC_SPECIALISTS.length ||
        [...this.specialists.keys()].some(
          (threadId) => !this.completedThreads.has(threadId),
        )
      ) {
        return this.fail(
          "INCOMPLETE_FAN_OUT",
          "TrueForge turn ended without exactly three completed diagnostic specialists",
        );
      }
    }

    if (event.type === "TURN_DONE") this.turnOpen = false;

    return undefined;
  }

  private resetTurn(): void {
    this.specialists.clear();
    this.observedNames.clear();
    this.completedThreads.clear();
    this.toolResults.clear();
    this.reviewThreadId = undefined;
    this.violation = undefined;
  }

  private fail(
    code: DiagnosticContractViolation["code"],
    reason: string,
  ): DiagnosticContractViolation {
    this.violation = { code, reason };
    return this.violation;
  }
}

export function evaluateDiagnosticContract(
  events: RuntimeEvent[],
): DiagnosticContractViolation | undefined {
  const guard = new DiagnosticContractGuard();
  let violation: DiagnosticContractViolation | undefined;
  for (const event of events) violation = guard.observe(event) ?? violation;
  return violation;
}

export function blockForDiagnosticViolation(
  state: SessionState,
  violation: DiagnosticContractViolation,
): boolean {
  if (state.status !== "ACTIVE") return false;
  state.phase = "BLOCKED";
  state.status = "BLOCKED";
  state.blockedReason = violation.reason;
  state.version += 1;
  return true;
}

function terminalStatus(event: RuntimeEvent): string | undefined {
  return readString(asRecord(asRecord(event.payload).state), "status");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
