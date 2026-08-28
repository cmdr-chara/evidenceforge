import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ApprovalRequest, digestCanonical, RuntimeEvent } from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { JsonSessionStore } from "../../packages/persistence/src";
import { EventJournal } from "../../packages/telemetry/src";
import { artifactBindingFor } from "../../packages/verification/src";
import { createOperationIntent } from "../../packages/workflow/src";
import {
  ApprovalResponse,
  DurableTrueForgeRuntime,
  RunTurnInput,
  StreamResult,
  TrueForgeRuntimeAdapter,
} from "../../packages/trueforge/src";
import { buildState } from "../fixtures/builders";

class FakeAdapter implements TrueForgeRuntimeAdapter {
  public submitted: ApprovalResponse[] = [];

  public async cancelSession(): Promise<void> {}

  public async createSession(): Promise<string> {
    return "tf-session";
  }

  public async runTurn(_input: RunTurnInput): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async submitApprovals(
    sessionId: string,
    approvals: ApprovalResponse[],
    onEvent?: RunTurnInput["onEvent"],
  ): Promise<StreamResult> {
    assert.equal(sessionId, "tf-session");
    this.submitted = structuredClone(approvals);
    const responseEvent: RuntimeEvent = {
      id: "tool-response-after-approval",
      type: "TOOL_RESULT",
      source: "trueforge:tool.response",
      threadId: "main",
      timestamp: "2026-08-25T19:39:59.000Z",
      payload: {
        type: "tool.response",
        id: "tool-response-after-approval",
        threadId: "main",
        toolCallId: "call-pr",
        content: JSON.stringify({
          status: approvals[0]?.decision === "allow" ? "OK" : "DENIED",
          retryable: false,
        }),
      },
      sequenceNumber: 11,
    };
    const turnEvent: RuntimeEvent = {
      id: "turn-created-after-approval",
      type: "TURN_CREATED",
      source: "trueforge:turn.created",
      timestamp: "2026-08-25T19:40:00.000Z",
      payload: {
        type: "turn.created",
        id: "turn-created-after-approval",
        turnId: "turn-after-approval",
      },
      sequenceNumber: 12,
    };
    await onEvent?.(responseEvent);
    await onEvent?.(turnEvent);
    return {
      sessionId,
      turnId: "turn-after-approval",
      lastSequenceNumber: 12,
      events: [responseEvent, turnEvent],
      paused: false,
      requiredActions: [],
    };
  }
}

function decidedApproval(
  state: ReturnType<typeof buildState>,
  status: "APPROVED" | "DENIED",
): ApprovalRequest {
  return {
    id: "approval-runtime",
    action: "github.create_pull_request",
    normalizedArguments: { head: "fix/demo" },
    risk: "EXTERNAL_REVERSIBLE",
    reason: "external write",
    reversible: true,
    status,
    toolCallId: "call-pr",
    threadId: "main",
    provenance: {
      actionDigest: digestCanonical({ head: "fix/demo" }),
      repository: state.task.repository,
      revision: state.task.revision,
      risk: "EXTERNAL_REVERSIBLE",
      originatingOperationId: "operation-runtime",
      binding: artifactBindingFor(state, "EXTERNAL"),
      issuedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

function addRuntimeOperation(state: ReturnType<typeof buildState>): void {
  state.operations.push(
    createOperationIntent({
      id: "operation-runtime",
      actionType: "github.create_pull_request",
      tool: "github.create_pull_request",
      normalizedArguments: { head: "fix/demo" },
      repository: state.task.repository,
      revision: state.task.revision,
      risk: "EXTERNAL_REVERSIBLE",
      replayPolicy: "RECONCILE_FIRST",
      expectedEvidence: ["tool result"],
    }),
  );
}

test("durable runtime submits the exact approved TrueForge tool call and persists its cursor", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-runtime-"));
  try {
    const adapter = new FakeAdapter();
    const sessions = new JsonSessionStore(join(root, "sessions"));
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      sessions,
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
    );
    const state = buildState();
    state.trueForgeSessionId = "tf-session";
    addRuntimeOperation(state);
    state.approvals.push(decidedApproval(state, "APPROVED"));

    const updated = await runtime.submitApproval(
      state,
      state.approvals[0] as ApprovalRequest,
      "APPROVED",
    );

    assert.deepEqual(adapter.submitted, [
      {
        threadId: "main",
        toolCallId: "call-pr",
        decision: "allow",
        reason: undefined,
      },
    ]);
    assert.equal(updated.activeTurnId, "turn-after-approval");
    assert.equal(updated.lastSequenceNumber, 12);
    assert.equal(updated.phase, "DEFINE_SUCCESS");
    assert.equal(updated.status, "ACTIVE");
    const persisted = await sessions.load(updated.task.id);
    assert.equal(persisted?.activeTurnId, "turn-after-approval");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("durable runtime maps a denied decision to a TrueForge deny response", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-runtime-deny-"));
  try {
    const adapter = new FakeAdapter();
    const runtime = new DurableTrueForgeRuntime(
      adapter,
      new JsonSessionStore(join(root, "sessions")),
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
    );
    const state = buildState();
    state.trueForgeSessionId = "tf-session";
    const approval = decidedApproval(state, "DENIED");
    state.approvals.push(approval);

    await runtime.submitApproval(state, approval, "DENIED", "human rejected the PR");

    assert.equal(adapter.submitted[0]?.decision, "deny");
    assert.equal(adapter.submitted[0]?.reason, "human rejected the PR");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("durable runtime rejects approval submission after the session is blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-runtime-blocked-approval-"));
  try {
    const runtime = new DurableTrueForgeRuntime(
      new FakeAdapter(),
      new JsonSessionStore(join(root, "sessions")),
      new EvidenceStore(),
      new EventJournal(join(root, "events.jsonl")),
    );
    const state = buildState();
    state.trueForgeSessionId = "tf-session";
    const approval = decidedApproval(state, "APPROVED");
    state.approvals.push(approval);
    state.status = "BLOCKED";
    state.phase = "BLOCKED";

    await assert.rejects(
      runtime.submitApproval(state, approval, "APPROVED"),
      /non-active session/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
