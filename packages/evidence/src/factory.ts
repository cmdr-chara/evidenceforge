import { createHash, randomUUID } from "node:crypto";
import { Evidence, EvidenceKind, VerificationStatus } from "../../domain/src/types";

export interface EvidenceInput {
  kind: EvidenceKind;
  sourceEventId: string;
  sourceTool: string;
  claim: string;
  artifactRefs?: string[];
  outcome?: VerificationStatus;
  metadata?: Record<string, string | number | boolean | null>;
  timestamp?: string;
  id?: string;
}

export function createEvidence(input: EvidenceInput): Evidence {
  return {
    id: input.id ?? `ev-${randomUUID()}`,
    kind: input.kind,
    sourceEventId: input.sourceEventId,
    sourceTool: input.sourceTool,
    claim: input.claim,
    artifactRefs: [...(input.artifactRefs ?? [])],
    outcome: input.outcome,
    timestamp: input.timestamp ?? new Date().toISOString(),
    metadata: input.metadata === undefined ? undefined : { ...input.metadata },
  };
}

export function artifactDigest(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
