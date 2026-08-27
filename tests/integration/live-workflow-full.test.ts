import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createSessionState,
  createTask,
  RuntimeEvent,
  SessionState,
} from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { JsonRuntimeCheckpointStore } from "../../packages/persistence/src";
import { EventJournal } from "../../packages/telemetry/src";
import { artifactBindingFor } from "../../packages/verification/src";
import {
  DurableTrueForgeRuntime,
  RunTurnInput,
  StreamResult,
  TrueForgeEventProjector,
  TrueForgeRuntimeAdapter,
} from "../../packages/trueforge/src";
import { buildCiSuccessContract } from "../../packages/workflow/src";
import { LiveWorkflowReducer } from "../../apps/server/src/live-workflow";

interface Harness {
  state: SessionState;
  store: EvidenceStore;
  projector: TrueForgeEventProjector;
  reducer: LiveWorkflowReducer;
  sequence: number;
}

test("live reducer projections persist through the runtime checkpoint boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidenceforge-live-reducer-"));
  try {
    const task = createTask({
      id: "task-live-reducer-persistence",
      objective: "Resolve live CI failure",
      repository: "cmdr-chara/evidenceforge",
      revision: "deadbeef",
      runId: "842",
      createdAt: "2026-08-26T14:00:00.000Z",
    });
    const state = createSessionState(task, buildCiSuccessContract(task));
    const evidenceStore = new EvidenceStore();
    const checkpoints = new JsonRuntimeCheckpointStore(join(root, "checkpoints"));
    const observedPhases: string[] = [];
    const reducer = new LiveWorkflowReducer(evidenceStore);
    const runtime = new DurableTrueForgeRuntime(
      new PlanningAdapter(),
      checkpoints,
      evidenceStore,
      new EventJournal(join(root, "events.jsonl")),
      (_event, snapshot) => {
        observedPhases.push(snapshot.phase);
      },
      undefined,
      (current, event) => reducer.apply(current, event),
    );

    const updated = await runtime.start(state, "start the live workflow");
    const persisted = await checkpoints.loadCheckpoint(task.id);
    assert.equal(updated.phase, "PLANNING");
    assert.ok(persisted);
    assert.equal(persisted.state.phase, "PLANNING");
    assert.equal(persisted.state.plan.steps.length, 8);
    assert.deepEqual(observedPhases, ["DEFINE_SUCCESS", "PLANNING"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("live workflow accepts an official GitHub read and rejects synthetic incident controls", () => {
  const harness = createHarness();
  const feed = (event: RuntimeEvent): void => {
    harness.sequence += 1;
    event.sequenceNumber = harness.sequence;
    assert.equal(harness.store.recordEvent(event), true);
    harness.projector.project(harness.state, event);
    harness.reducer.apply(harness.state, event);
  };

  feed(turnCreated());
  for (const [index, name] of [
    "Repository Investigator",
    "Failure / Log Investigator",
    "Dependency / Configuration Investigator",
  ].entries()) {
    feed(threadCreated(index + 1, name));
  }
  assert.equal(harness.state.phase, "PLANNING");
  assert.equal(harness.state.plan.steps.length, 8);

  feed(
    structuredCall("call-context", "github", "get_commit", {
      owner: "cmdr-chara",
      repo: "evidenceforge",
      sha: harness.state.task.revision,
    }),
  );
  feed(
    toolResponse("call-context", {
      success: true,
      response: {
        sha: harness.state.task.revision,
        repository: harness.state.task.repository,
        commit: { message: "workflow failure" },
      },
    }),
  );
  assert.equal(
    harness.state.successCriteria.find((criterion) => criterion.id === "incident-context")?.status,
    "PASS",
  );

  // Actions/run-log tools are not part of the connected GitHub MCP surface;
  // an old synthetic intent must not make them admissible.
  feed(
    structuredCall("call-forged-context", "github", "get_run", {
      intent: "evidenceforge.incident-context",
      artifactRef: `artifact://${harness.state.task.id}/incident-context.json`,
    }),
  );
  feed(toolResponse("call-forged-context", {
    success: true,
    response: { status: "OK", result: "workflow logs" },
  }));
  assert.equal(harness.state.status, "BLOCKED");
  assert.equal(harness.state.completionCertificate, undefined);
});

test("live external publishing stores only an official PR receipt and requires a later read", () => {
  const harness = createHarness();
  harness.state.phase = "PUBLISHING";
  harness.state.status = "ACTIVE";
  harness.state.patchDigest = "a".repeat(64);
  const official = {
    owner: "cmdr-chara",
    repo: "evidenceforge",
    title: "fix: enforce completion evidence",
    body: "Evidence-backed remediation.",
    head: "feat/foundation-control-plane",
    base: "determination",
  };
  harness.state.externalAction = {
    type: "pull_request",
    idempotencyKey: "durable-idempotency",
    operationId: "durable-operation",
    replayPolicy: "RECONCILE_FIRST",
    preparedArguments: {
      repository: harness.state.task.repository,
      base: official.base,
      head: official.head,
      title: official.title,
      body: official.body,
      expectedHeadSha: "abcdef1234567",
    },
    binding: artifactBindingFor(harness.state, "EXTERNAL"),
    status: "APPROVED",
  };
  harness.state.approvals = [{
    id: "approval-pr",
    action: "github.create_pull_request",
    normalizedArguments: official,
    risk: "EXTERNAL_REVERSIBLE",
    reason: "test",
    reversible: true,
    status: "APPROVED",
    toolCallId: "call-pr",
    threadId: "main",
  }];

  const record = (event: RuntimeEvent): void => {
    harness.sequence += 1;
    event.sequenceNumber = harness.sequence;
    assert.equal(harness.store.recordEvent(event), true);
    harness.projector.project(harness.state, event);
    harness.reducer.apply(harness.state, event);
  };
  record(structuredCall("call-pr", "github", "create_pull_request", official));
  record(toolResponse("call-pr", {
    success: true,
    response: {
      id: 908172,
      url: "https://github.com/cmdr-chara/evidenceforge/pull/219",
    },
  }));
  assert.equal(harness.state.externalAction?.status, "COMMITTED");
  assert.equal(harness.state.externalAction?.identifier, "#219");
  assert.equal(harness.state.completionCertificate, undefined);

  record(structuredCall("call-read", "github", "pull_request_read", {
    owner: "cmdr-chara",
    repo: "evidenceforge",
    pullNumber: 219,
    method: "get",
  }));
  record(toolResponse("call-read", {
    success: true,
    response: {
      number: 219,
      head: {
        ref: official.head,
        sha: "wrongsha",
        repo: { full_name: harness.state.task.repository },
      },
      base: {
        ref: official.base,
        repo: { full_name: harness.state.task.repository },
      },
    },
  }));
  assert.equal(harness.state.status, "BLOCKED");
  assert.equal(harness.state.completionCertificate, undefined);
});

test("live workflow blocks stale reconciliation and never promotes model prose", () => {
  const harness = createHarness();
  const prose = event("MODEL_MESSAGE", "prose", {
    type: "model.message",
    content: "All tests passed and the pull request is complete.",
  });
  harness.store.recordEvent(prose);
  harness.projector.project(harness.state, prose);
  harness.reducer.apply(harness.state, prose);
  assert.equal(harness.state.phase, "INTAKE");
  assert.equal(harness.state.completionCertificate, undefined);

  harness.state.phase = "PUBLISHING";
  harness.state.status = "ACTIVE";
  harness.state.patchDigest = "a".repeat(64);
  harness.state.externalAction = {
    type: "pull_request",
    idempotencyKey: "idempotency",
    operationId: "operation",
    replayPolicy: "RECONCILE_FIRST",
    preparedArguments: {
      repository: harness.state.task.repository,
      base: "determination",
      head: "fix",
      title: "fix",
      body: "body",
      expectedHeadSha: "abcdef1",
    },
    binding: artifactBindingFor(harness.state, "EXTERNAL"),
    status: "COMMITTED",
  };
  const stale = event("EXTERNAL_RECONCILIATION", "stale-reconcile", {
    type: "external.reconciliation",
    identity: {
      identifier: "#1",
      repository: harness.state.task.repository,
      base: "determination",
      head: "fix",
      headSha: "wrongsha",
      operationId: "operation",
      idempotencyKey: "idempotency",
    },
  });
  harness.store.recordEvent(stale);
  harness.reducer.apply(harness.state, stale);
  assert.equal(harness.state.status, "BLOCKED");
  assert.equal(harness.state.completionCertificate, undefined);
});

class PlanningAdapter implements TrueForgeRuntimeAdapter {
  public async createSession(): Promise<string> {
    return "tf-live-reducer-persistence";
  }

  public async cancelSession(): Promise<void> {}

  public async runTurn(input: RunTurnInput): Promise<StreamResult> {
    const events = [turnCreated(), threadCreated(1, "Repository Investigator")].map((item, index) => ({
      ...item,
      sequenceNumber: index + 1,
    }));
    for (const item of events) await input.onEvent?.(item);
    return {
      sessionId: input.sessionId,
      turnId: "turn-1",
      lastSequenceNumber: events.length,
      events,
      paused: false,
      requiredActions: [],
    };
  }

  public async submitApprovals(): Promise<StreamResult> {
    throw new Error("not used");
  }

  public async resumeTurn(): Promise<StreamResult> {
    throw new Error("not used");
  }
}

function createHarness(): Harness {
  const task = createTask({
    id: "task-live-full-trace",
    objective: "Resolve live CI failure",
    repository: "cmdr-chara/evidenceforge",
    revision: "deadbeef",
    runId: "842",
    createdAt: "2026-08-26T14:00:00.000Z",
  });
  const store = new EvidenceStore();
  return {
    state: createSessionState(task, buildCiSuccessContract(task)),
    store,
    projector: new TrueForgeEventProjector(undefined, store),
    reducer: new LiveWorkflowReducer(store),
    sequence: 0,
  };
}

function turnCreated(): RuntimeEvent {
  return event("TURN_CREATED", "turn-created", { type: "turn.created", turnId: "turn-1" });
}

function threadCreated(index: number, name: string): RuntimeEvent {
  return {
    ...event("THREAD_CREATED", `thread-created-${index}`, {
      type: "thread.created",
      threadId: `thread-${index}`,
      agentInfo: { type: "dynamic", name },
      parent: { threadId: "main", toolCallId: `fanout-${index}` },
    }),
    threadId: `thread-${index}`,
  };
}

function structuredCall(
  callId: string,
  serverName: string,
  name: string,
  args: Record<string, unknown>,
  threadId = "main",
  toolType = "mcp",
): RuntimeEvent {
  return {
    ...event("MODEL_MESSAGE", `message-${callId}`, {
      type: "model.message",
      threadId,
      toolCalls: [{
        id: callId,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
        toolInfo: { type: toolType, serverName },
      }],
    }),
    threadId,
  };
}

function toolResponse(callId: string, content: unknown, threadId = "main"): RuntimeEvent {
  responseSequence += 1;
  return {
    ...event("TOOL_RESULT", `response-${callId}-${responseSequence}`, {
      type: "tool.response",
      threadId,
      toolCallId: callId,
      content: JSON.stringify(content),
    }),
    threadId,
  };
}

let responseSequence = 0;

function event(type: RuntimeEvent["type"], id: string, payload: unknown): RuntimeEvent {
  return {
    id,
    type,
    source: `trueforge:test.${type.toLowerCase()}`,
    timestamp: "2026-08-26T14:00:00.000Z",
    payload: { ...(payload as Record<string, unknown>), id },
  };
}
