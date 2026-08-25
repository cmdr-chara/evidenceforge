import { posix } from "node:path";
import {
  SessionState,
  SuccessCriterion,
  ToolResult,
  VerificationResult,
  VerifierSpec,
} from "../../domain/src/types";
import { EvidenceStore } from "../../evidence/src";
import { VerificationEngine } from "../../verification/src";
import { IndexedToolCall } from "./event-index";

export const VERIFIER_INTENT_PREFIX = "evidenceforge.verify:";

export interface VerifierManifestEntry {
  criterionId: string;
  intent: string;
  tool: "sandbox.exec";
  command: string;
  cwd: string;
  timeoutSeconds: number;
}

export interface VerifierProjectionOutcome {
  recognized: boolean;
  result?: VerificationResult;
  rejection?: string;
}

export class TrueForgeVerifierProjector {
  private readonly engine: VerificationEngine;

  public constructor(private readonly evidenceStore: EvidenceStore) {
    this.engine = new VerificationEngine(evidenceStore);
  }

  public project(
    state: SessionState,
    toolCall: IndexedToolCall,
    toolResult: ToolResult,
  ): VerifierProjectionOutcome {
    const parsedArguments = parseArguments(toolCall.arguments);
    const intent = parsedArguments === undefined ? undefined : readString(parsedArguments, "intent");
    if (intent === undefined || !intent.startsWith(VERIFIER_INTENT_PREFIX)) {
      return { recognized: false };
    }

    const criterionId = intent.slice(VERIFIER_INTENT_PREFIX.length);
    if (criterionId.length === 0 || intent !== `${VERIFIER_INTENT_PREFIX}${criterionId}`) {
      return reject("verifier intent must contain exactly one criterion ID");
    }
    if (state.status !== "ACTIVE") {
      return reject(`session status ${state.status} cannot accept verifier results`);
    }

    const criterion = state.successCriteria.find((candidate) => candidate.id === criterionId);
    if (criterion === undefined) return reject(`unknown success criterion ${criterionId}`);
    const expected = verifierExecution(criterion.verifier);
    if (expected === undefined) {
      return reject(`criterion ${criterionId} is not executable through sandbox.exec`);
    }
    if (!isSandboxExec(toolCall)) {
      return reject(`criterion ${criterionId} must run through the TrueForge sandbox.exec tool`);
    }
    if (parsedArguments === undefined) {
      return reject(`criterion ${criterionId} has malformed sandbox arguments`);
    }

    const command = readString(parsedArguments, "command");
    if (command !== expected.command) {
      return reject(
        `criterion ${criterionId} command mismatch: expected ${JSON.stringify(expected.command)}`,
      );
    }
    const cwd = readString(parsedArguments, "cwd");
    if (cwd === undefined || normalizeCwd(cwd) !== normalizeCwd(expected.cwd)) {
      return reject(
        `criterion ${criterionId} cwd mismatch: expected ${JSON.stringify(expected.cwd)}`,
      );
    }
    const env = parsedArguments.env;
    if (env !== undefined && (!isRecord(env) || Object.keys(env).length > 0)) {
      return reject(`criterion ${criterionId} cannot override verifier environment variables`);
    }

    const evidenceId = `evidence-${toolResult.callId}`;
    const existing = state.verifierResults.find(
      (result) =>
        result.criterionId === criterionId && result.evidenceIds.includes(evidenceId),
    );
    if (existing !== undefined) {
      if (!this.evidenceStore.hasEvidence(evidenceId)) {
        return reject(
          `criterion ${criterionId} has a persisted verifier result but its evidence is unavailable`,
        );
      }
      toolResult.evidenceIds = unique([...toolResult.evidenceIds, ...existing.evidenceIds]);
      return { recognized: true, result: structuredClone(existing) };
    }

    const result = this.engine.verify(criterion, toolResult);
    this.engine.applyResult(state, result);
    toolResult.evidenceIds = unique([...toolResult.evidenceIds, ...result.evidenceIds]);
    return { recognized: true, result };
  }
}

export function buildVerifierManifest(criteria: SuccessCriterion[]): VerifierManifestEntry[] {
  return criteria.flatMap((criterion) => {
    const execution = verifierExecution(criterion.verifier);
    if (execution === undefined) return [];
    return [
      {
        criterionId: criterion.id,
        intent: `${VERIFIER_INTENT_PREFIX}${criterion.id}`,
        tool: "sandbox.exec" as const,
        command: execution.command,
        cwd: execution.cwd,
        timeoutSeconds: execution.timeoutSeconds,
      },
    ];
  });
}

export function renderArgv(argv: string[]): string {
  if (argv.length === 0) throw new Error("verifier argv cannot be empty");
  return argv.map(shellQuote).join(" ");
}

function verifierExecution(
  verifier: VerifierSpec,
): { command: string; cwd: string; timeoutSeconds: number } | undefined {
  switch (verifier.kind) {
    case "COMMAND":
    case "FAILURE_SIGNATURE":
      return {
        command: renderArgv(verifier.argv),
        cwd: verifier.cwd,
        timeoutSeconds: verifier.timeoutSeconds,
      };
    case "DIFF_INTEGRITY":
      return {
        command: "git diff --check",
        cwd: verifier.cwd,
        timeoutSeconds: verifier.timeoutSeconds,
      };
    case "SCHEMA_FILE":
    case "REVIEWER":
    case "EXTERNAL_STATE":
      return undefined;
  }
}

function isSandboxExec(call: IndexedToolCall): boolean {
  return (
    call.name === "exec" &&
    (call.serverName === "sandbox" || call.toolType === "truefoundry-system")
  );
}

function parseArguments(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeCwd(value: string): string {
  const normalized = posix.normalize(value);
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function reject(rejection: string): VerifierProjectionOutcome {
  return { recognized: true, rejection };
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
