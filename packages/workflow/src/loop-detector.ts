import { createHash, randomUUID } from "node:crypto";
import { canonicalJson, SessionState, ToolAttemptRecord } from "../../domain/src";
import { createEvidence, EvidenceStore } from "../../evidence/src";

export interface ToolAttemptInput {
  tool: string;
  normalizedArguments: unknown;
  workspaceRevision: string;
  resultSignature: string;
  evidenceIds: string[];
  stateDigest: string;
}

export class NoProgressDetector {
  public constructor(
    private readonly reconsiderAt = 2,
    private readonly replanAt = 3,
    private readonly escalateAt = 4,
  ) {}

  public observe(
    state: SessionState,
    input: ToolAttemptInput,
    evidenceStore?: EvidenceStore,
    now = new Date().toISOString(),
  ): ToolAttemptRecord {
    const normalizedArguments = normalizeSemantic(input.normalizedArguments);
    const fingerprint = createHash("sha256")
      .update(
        canonicalJson({
          tool: input.tool,
          normalizedArguments,
          workspaceRevision: input.workspaceRevision,
          resultSignature: normalizeResultSignature(input.resultSignature),
          stateDigest: input.stateDigest,
        }),
      )
      .digest("hex");
    const prior = state.toolAttempts.filter((attempt) => attempt.fingerprint === fingerprint);
    const knownEvidence = new Set(prior.flatMap((attempt) => attempt.evidenceIds));
    const hasNewEvidence = input.evidenceIds.some((id) => !knownEvidence.has(id));
    const repetition = hasNewEvidence ? 1 : prior.length + 1;
    const outcome =
      repetition >= this.escalateAt
        ? "ESCALATE"
        : repetition >= this.replanAt
          ? "REPLAN"
          : repetition >= this.reconsiderAt
            ? "RECONSIDER"
            : "PROGRESS";
    const attempt: ToolAttemptRecord = {
      id: `attempt-${randomUUID()}`,
      fingerprint,
      tool: input.tool,
      normalizedArguments,
      workspaceRevision: input.workspaceRevision,
      resultSignature: normalizeResultSignature(input.resultSignature),
      evidenceIds: [...input.evidenceIds],
      stateDigest: input.stateDigest,
      outcome,
      timestamp: now,
    };
    state.toolAttempts.push(structuredClone(attempt));
    state.version += 1;

    if (outcome !== "PROGRESS" && evidenceStore !== undefined) {
      const eventId = `event-loop-${attempt.id}`;
      evidenceStore.recordEvent({
        id: eventId,
        type: "STATE_TRANSITION",
        source: "evidenceforge.loop-detector",
        timestamp: now,
        payload: { fingerprint, repetition, outcome },
      });
      const evidence = createEvidence({
        kind: "OBSERVATION",
        sourceEventId: eventId,
        sourceTool: "evidenceforge.loop-detector",
        claim: `${repetition} equivalent ${input.tool} attempts produced no new evidence or state`,
        metadata: { fingerprint, repetition, outcome },
        timestamp: now,
      });
      evidenceStore.recordEvidence(evidence);
      state.evidenceIds.push(evidence.id);
      state.version += 1;
    }
    return structuredClone(attempt);
  }
}

function normalizeSemantic(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeSemantic(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeSemantic(entryValue, entryKey),
      ]),
    );
  }
  if (typeof value !== "string") return value;
  if (key === "command" || key === "query") return value.trim().replace(/\s+/g, " ");
  if (key === "path" || key === "cwd") return value.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return value;
}

function normalizeResultSignature(value: string): string {
  return value
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "<duration>")
    .replace(/0x[\da-f]+/gi, "<address>")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
