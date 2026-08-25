import { randomUUID } from "node:crypto";
import {
  Evidence,
  ReviewerVerdict,
  RuntimeEvent,
  SuccessCriterion,
  ToolResult,
  VerificationResult,
  VerificationStatus,
} from "../../domain/src/types";
import { createEvidence, EvidenceStore } from "../../evidence/src";

export class VerificationCorrelationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "VerificationCorrelationError";
  }
}

export interface VerificationEvaluation {
  result: VerificationResult;
  evidence: Evidence;
}

export class VerificationEngine {
  public constructor(private readonly evidenceStore: EvidenceStore) {}

  public evaluateToolResult(
    criterion: SuccessCriterion,
    event: RuntimeEvent,
    toolResult: ToolResult,
  ): VerificationEvaluation {
    this.assertCorrelated(event, toolResult);
    const { status, details } = evaluateDeterministic(criterion, toolResult);
    const evidence = createEvidence({
      id: `ev-${randomUUID()}`,
      kind:
        criterion.verifier.kind === "FAILURE_SIGNATURE" ||
        (criterion.verifier.kind === "COMMAND" && criterion.verifier.purpose === "REPRODUCTION")
          ? "REPRODUCTION"
          : "VERIFICATION",
      sourceEventId: event.id,
      sourceTool: toolResult.tool,
      claim: details,
      artifactRefs: toolResult.artifactRefs,
      outcome: status,
      metadata: {
        callId: toolResult.callId,
        durationMs: toolResult.durationMs,
        exitCode: toolResult.exitCode ?? null,
      },
    });
    this.evidenceStore.recordEvidence(evidence);
    return {
      evidence,
      result: {
        criterionId: criterion.id,
        status,
        verifier: criterion.verifier.kind,
        evidenceIds: [evidence.id],
        details,
        deterministic: true,
      },
    };
  }

  public evaluateReviewer(
    criterion: SuccessCriterion,
    event: RuntimeEvent,
    verdict: ReviewerVerdict,
    details: string,
  ): VerificationEvaluation {
    if (criterion.verifier.kind !== "REVIEWER") {
      throw new VerificationCorrelationError("review verdict supplied to non-review criterion");
    }
    if (event.type === "MODEL_MESSAGE") {
      throw new VerificationCorrelationError(
        "free-form model messages are not admissible review evidence; use a structured reviewer event",
      );
    }
    const status: VerificationStatus = criterion.verifier.allowedVerdicts.includes(
      verdict as "PASS" | "PASS_WITH_WARNINGS",
    )
      ? "PASS"
      : "FAIL";
    const evidence = createEvidence({
      kind: "REVIEW",
      sourceEventId: event.id,
      sourceTool: "independent-reviewer",
      claim: details,
      outcome: status,
      metadata: { verdict },
    });
    this.evidenceStore.recordEvidence(evidence);
    return {
      evidence,
      result: {
        criterionId: criterion.id,
        status,
        verifier: "REVIEWER",
        evidenceIds: [evidence.id],
        details,
        deterministic: false,
      },
    };
  }

  public evaluateExternalState(
    criterion: SuccessCriterion,
    event: RuntimeEvent,
    identifier: string,
    headSha: string,
  ): VerificationEvaluation {
    if (criterion.verifier.kind !== "EXTERNAL_STATE") {
      throw new VerificationCorrelationError("external state supplied to non-external criterion");
    }
    if (event.type !== "EXTERNAL_RECONCILIATION") {
      throw new VerificationCorrelationError("external result must come from reconciliation event");
    }
    const expected = criterion.verifier.expectedHeadSha;
    const status: VerificationStatus = expected === undefined || expected === headSha ? "PASS" : "FAIL";
    const details =
      status === "PASS"
        ? `GitHub confirmed pull request ${identifier} at head ${headSha}`
        : `GitHub returned head ${headSha}, expected ${expected}`;
    const evidence = createEvidence({
      kind: "EXTERNAL_RESULT",
      sourceEventId: event.id,
      sourceTool: "github-mcp.reconcile-pull-request",
      claim: details,
      outcome: status,
      metadata: { identifier, headSha },
    });
    this.evidenceStore.recordEvidence(evidence);
    return {
      evidence,
      result: {
        criterionId: criterion.id,
        status,
        verifier: "EXTERNAL_STATE",
        evidenceIds: [evidence.id],
        details,
        deterministic: true,
      },
    };
  }

  private assertCorrelated(event: RuntimeEvent, toolResult: ToolResult): void {
    if (event.id !== toolResult.eventId) {
      throw new VerificationCorrelationError(
        `tool result event ${toolResult.eventId} does not match runtime event ${event.id}`,
      );
    }
    if (event.type !== "TOOL_RESULT") {
      throw new VerificationCorrelationError(`event ${event.id} is not a TOOL_RESULT`);
    }
    if (this.evidenceStore.getEvent(event.id) === undefined) {
      throw new VerificationCorrelationError(`runtime event ${event.id} is not registered`);
    }
  }
}

function evaluateDeterministic(
  criterion: SuccessCriterion,
  result: ToolResult,
): { status: VerificationStatus; details: string } {
  if (result.status === "TIMEOUT") {
    return { status: "FAIL", details: `${result.tool} timed out after ${result.durationMs}ms` };
  }
  if (result.status !== "OK") {
    return {
      status: "FAIL",
      details: `${result.tool} returned ${result.status}${result.errorCode ? ` (${result.errorCode})` : ""}`,
    };
  }

  const output = `${result.stdoutPreview ?? ""}\n${result.stderrPreview ?? ""}`;
  switch (criterion.verifier.kind) {
    case "COMMAND": {
      if (result.exitCode !== criterion.verifier.expectedExitCode) {
        return {
          status: "FAIL",
          details: `command exited ${String(result.exitCode)}, expected ${criterion.verifier.expectedExitCode}`,
        };
      }
      const missing = (criterion.verifier.outputMustContain ?? []).filter(
        (needle) => !output.includes(needle),
      );
      if (missing.length > 0) {
        return { status: "FAIL", details: `command output missed: ${missing.join(", ")}` };
      }
      return {
        status: "PASS",
        details: `command exited ${criterion.verifier.expectedExitCode} with required output`,
      };
    }
    case "FAILURE_SIGNATURE":
      if ((result.exitCode ?? 0) === 0) {
        return { status: "FAIL", details: "original failure was not reproduced: command exited 0" };
      }
      return output.includes(criterion.verifier.signature)
        ? { status: "PASS", details: `failure reproduced with signature: ${criterion.verifier.signature}` }
        : { status: "FAIL", details: `non-zero exit did not match signature: ${criterion.verifier.signature}` };
    case "DIFF_INTEGRITY":
      return result.exitCode === 0
        ? { status: "PASS", details: "git diff --check passed" }
        : { status: "FAIL", details: "git diff --check failed" };
    case "SCHEMA_FILE":
      return result.artifactRefs.includes(criterion.verifier.artifactRef)
        ? { status: "PASS", details: `artifact ${criterion.verifier.artifactRef} validated` }
        : { status: "INCONCLUSIVE", details: "expected schema artifact was not produced" };
    case "REVIEWER":
    case "EXTERNAL_STATE":
      throw new VerificationCorrelationError(
        `${criterion.verifier.kind} must be evaluated through its dedicated method`,
      );
  }
}
