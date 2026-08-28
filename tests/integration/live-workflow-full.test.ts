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
  const feed = createFeed(harness);

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

test("live workflow does not infer root cause from exact context and reproduction alone", () => {
  const harness = createHarness();
  const feed = createFeed(harness);

  feed(turnCreated());
  for (const [index, name] of [
    "Repository Investigator",
    "Failure / Log Investigator",
    "Dependency / Configuration Investigator",
  ].entries()) {
    feed(threadCreated(index + 1, name));
    feed(diagnosticThreadDone(index + 1));
  }

  feedExactIncidentContext(harness, feed, "call-context-without-cause");
  feedExactReproduction(feed, "call-reproduce-without-cause");

  assert.equal(
    harness.state.successCriteria.find((criterion) => criterion.id === "incident-context")?.status,
    "PASS",
  );
  assert.equal(
    harness.state.successCriteria.find((criterion) => criterion.id === "failure-reproduced")?.status,
    "PASS",
  );
  assert.equal(
    harness.state.successCriteria.find((criterion) => criterion.id === "root-cause-supported")?.status,
    "PENDING",
  );
  assert.equal(harness.state.hypotheses.length, 0);
  assert.equal(harness.state.phase, "INVESTIGATING");
  assert.equal(harness.state.status, "ACTIVE");
  assert.equal(harness.state.completionCertificate, undefined);
});

test("live workflow requires structured diagnostic causal evidence before root cause passes", () => {
  const harness = createHarness();
  const feed = createFeed(harness);

  feed(turnCreated());
  const specialists = [
    "Repository Investigator",
    "Failure / Log Investigator",
    "Dependency / Configuration Investigator",
  ];
  for (const [index, name] of specialists.entries()) {
    feed(threadCreated(index + 1, name));
    if (name === "Failure / Log Investigator") {
      feedDiagnosticEvidence(feed, index + 1);
    }
    feed(
      diagnosticThreadDone(
        index + 1,
        name === "Failure / Log Investigator" ? causalDiagnosticOutput() : undefined,
      ),
    );
  }

  feedExactIncidentContext(harness, feed, "call-context-with-cause");
  feedExactReproduction(feed, "call-reproduce-with-cause");

  const rootCause = harness.state.successCriteria.find(
    (criterion) => criterion.id === "root-cause-supported",
  );
  assert.equal(rootCause?.status, "PASS");
  assert.equal(rootCause?.evidenceIds.length, 1);
  const gateEvidence = harness.store.getEvidence(rootCause?.evidenceIds[0] ?? "");
  assert.equal(gateEvidence?.sourceTool, "evidenceforge.root-cause-gate");
  assert.equal(gateEvidence?.metadata?.diagnosticEvidenceCount, 1);
  assert.equal(gateEvidence?.metadata?.supportingEvidenceCount, 3);
  assert.equal(harness.state.hypotheses.length, 1);
  assert.equal(harness.state.hypotheses[0]?.status, "SUPPORTED");
  assert.equal(harness.state.hypotheses[0]?.supportingEvidence.length, 3);
  const diagnosticEvidence = harness.state.hypotheses[0]?.supportingEvidence
    .map((id) => harness.store.getEvidence(id))
    .find((evidence) => evidence?.kind === "OBSERVATION");
  assert.deepEqual(
    diagnosticEvidence?.artifactRefs.map((reference) => reference.startsWith("runtime-event://")),
    [true],
  );
  assert.equal(diagnosticEvidence?.artifactRefs.includes("CONFIG_VALIDATION_ORDER"), false);
  assert.match(
    harness.state.hypotheses[0]?.statement ?? "",
    /Causal mechanism:/,
  );
  assert.equal(harness.state.phase, "PATCHING");
  assert.equal(harness.state.status, "ACTIVE");
  assert.equal(harness.state.completionCertificate, undefined);
});

test("live workflow blocks model-authored diagnostic references without recorded evidence", () => {
  const harness = createHarness();
  const feed = createFeed(harness);

  feed(turnCreated());
  feed(threadCreated(1, "Repository Investigator"));
  feed(diagnosticThreadDone(1, causalDiagnosticOutput()));

  assert.equal(harness.state.status, "BLOCKED");
  assert.match(harness.state.blockedReason ?? "", /not observed in its specialist thread/);
  assert.equal(harness.state.hypotheses.length, 0);
  assert.equal(harness.store.listEvidence().length, 0);
  assert.equal(harness.state.completionCertificate, undefined);
});

test("live workflow rejects diagnostic evidence recorded by a different specialist", () => {
  const harness = createHarness();
  const feed = createFeed(harness);

  feed(turnCreated());
  feed(threadCreated(1, "Repository Investigator"));
  feed(threadCreated(2, "Failure / Log Investigator"));
  feedDiagnosticEvidence(feed, 2);
  feed(diagnosticThreadDone(1, causalDiagnosticOutput()));

  assert.equal(harness.state.status, "BLOCKED");
  assert.match(harness.state.blockedReason ?? "", /not observed in its specialist thread/);
  assert.equal(harness.state.hypotheses.length, 0);
  assert.equal(harness.state.completionCertificate, undefined);
});

test("live workflow rejects references found only in a failed diagnostic tool result", () => {
  const harness = createHarness();
  const feed = createFeed(harness);

  feed(turnCreated());
  feed(threadCreated(1, "Repository Investigator"));
  const callId = "call-failed-diagnostic-evidence";
  feed(structuredCall(
    callId,
    "repository",
    "read",
    { path: "packages/trueforge/src/runtime.ts" },
    "thread-1",
    "truefoundry-system",
  ));
  feed(toolResponse(callId, {
    success: false,
    response: {
      result:
        "runtime.ts:projectToolResult and CONFIG_VALIDATION_ORDER were not actually inspected",
    },
  }, "thread-1"));
  feed(diagnosticThreadDone(1, causalDiagnosticOutput()));

  assert.equal(harness.state.status, "BLOCKED");
  assert.match(harness.state.blockedReason ?? "", /not observed in its specialist thread/);
  assert.equal(harness.state.hypotheses.length, 0);
  assert.equal(harness.state.completionCertificate, undefined);
});

test("live workflow rejects references found only in a deeply nested failed tool result", () => {
  const harness = createHarness();
  const feed = createFeed(harness);

  feed(turnCreated());
  feed(threadCreated(1, "Repository Investigator"));
  const callId = "call-nested-failed-diagnostic-evidence";
  feed(structuredCall(
    callId,
    "repository",
    "read",
    { path: "packages/trueforge/src/runtime.ts" },
    "thread-1",
    "truefoundry-system",
  ));
  feed(toolResponse(callId, {
    success: true,
    response: {
      result: {
        status: "ERROR",
        result:
          "runtime.ts:projectToolResult and CONFIG_VALIDATION_ORDER came from a failed result",
      },
    },
  }, "thread-1"));
  feed(diagnosticThreadDone(1, causalDiagnosticOutput()));

  assert.equal(harness.state.status, "BLOCKED");
  assert.match(harness.state.blockedReason ?? "", /not observed in its specialist thread/);
  assert.equal(harness.state.hypotheses.length, 0);
  assert.equal(harness.state.completionCertificate, undefined);
});

for (const exitCodeField of ["exitCode", "exit_code"] as const) {
  test(`live workflow rejects references from a nonzero ${exitCodeField} tool result`, () => {
    const harness = createHarness();
    const feed = createFeed(harness);

    feed(turnCreated());
    feed(threadCreated(1, "Repository Investigator"));
    const callId = `call-${exitCodeField}-diagnostic-evidence`;
    feed(structuredCall(
      callId,
      "repository",
      "read",
      { path: "packages/trueforge/src/runtime.ts" },
      "thread-1",
      "truefoundry-system",
    ));
    feed(toolResponse(callId, {
      success: true,
      response: {
        result: {
          [exitCodeField]: 1,
          result:
            "runtime.ts:projectToolResult and CONFIG_VALIDATION_ORDER came from a failed command",
        },
      },
    }, "thread-1"));
    feed(diagnosticThreadDone(1, causalDiagnosticOutput()));

    assert.equal(harness.state.status, "BLOCKED");
    assert.match(harness.state.blockedReason ?? "", /not observed in its specialist thread/);
    assert.equal(harness.state.hypotheses.length, 0);
    assert.equal(harness.state.completionCertificate, undefined);
  });
}

test("live workflow rejects diagnostic reference prefixes", () => {
  const harness = createHarness();
  const feed = createFeed(harness);

  feed(turnCreated());
  feed(threadCreated(1, "Repository Investigator"));
  const callId = "call-prefixed-diagnostic-evidence";
  feed(structuredCall(
    callId,
    "repository",
    "read",
    { path: "packages/trueforge/src/runtime.ts" },
    "thread-1",
    "truefoundry-system",
  ));
  feed(toolResponse(callId, {
    success: true,
    response: {
      result: "runtime.ts:123 contains the observed failure location",
    },
  }, "thread-1"));
  feed(diagnosticThreadDone(1, causalDiagnosticOutput(["runtime.ts:12"])));

  assert.equal(harness.state.status, "BLOCKED");
  assert.match(harness.state.blockedReason ?? "", /not observed in its specialist thread/);
  assert.equal(harness.state.hypotheses.length, 0);
  assert.equal(harness.state.completionCertificate, undefined);
});

test("live workflow does not resolve diagnostic references from transport keys", () => {
  const harness = createHarness();
  const feed = createFeed(harness);

  feed(turnCreated());
  feed(threadCreated(1, "Repository Investigator"));
  const callId = "call-generic-diagnostic-evidence";
  feed(structuredCall(
    callId,
    "repository",
    "read",
    { path: "packages/trueforge/src/runtime.ts" },
    "thread-1",
    "truefoundry-system",
  ));
  feed(toolResponse(callId, {
    success: true,
    response: { result: "bounded output without the claimed reference" },
  }, "thread-1"));
  feed(diagnosticThreadDone(1, causalDiagnosticOutput(["response"])));

  assert.equal(harness.state.status, "BLOCKED");
  assert.match(harness.state.blockedReason ?? "", /not observed in its specialist thread/);
  assert.equal(harness.state.hypotheses.length, 0);
  assert.equal(harness.state.completionCertificate, undefined);
});

test("live workflow blocks malformed claimed diagnostic causality", () => {
  const harness = createHarness();
  const feed = createFeed(harness);

  feed(turnCreated());
  feed(threadCreated(1, "Repository Investigator"));
  feed(diagnosticThreadDone(1, {
    schemaVersion: 1,
    findings: ["The command failed."],
    rootCauseHypotheses: [{
      id: "symptom-only",
      cause: "The command at the incident revision returns a non-zero exit status.",
      affectedLocations: ["test output"],
      evidenceReferences: ["CONFIG_VALIDATION_ORDER"],
      status: "SUPPORTED",
    }],
    unresolvedQuestions: [],
  }));

  assert.equal(harness.state.status, "BLOCKED");
  assert.match(harness.state.blockedReason ?? "", /causal evidence schema/);
  assert.equal(
    harness.state.successCriteria.find((criterion) => criterion.id === "root-cause-supported")?.status,
    "PENDING",
  );
  assert.equal(harness.state.completionCertificate, undefined);
});

test("live workflow accepts only a digest-bound isolated reviewer result", () => {
  const harness = createHarness();
  const feed = createFeed(harness);
  feed(turnCreated());
  for (const [index, name] of [
    "Repository Investigator",
    "Failure / Log Investigator",
    "Dependency / Configuration Investigator",
  ].entries()) {
    feed(threadCreated(index + 1, name));
    feed({
      ...event("THREAD_DONE", `review-prep-done-${index + 1}`, {
        type: "thread.done",
        threadId: `thread-${index + 1}`,
        state: { status: "done" },
      }),
      threadId: `thread-${index + 1}`,
    });
  }
  harness.state.phase = "REVIEWING";
  harness.state.patchDigest = "a".repeat(64);
  feed({
    ...event("THREAD_CREATED", "review-created", {
      type: "thread.created",
      threadId: "review-thread",
      agentInfo: { type: "dynamic", name: "Independent Patch Reviewer" },
      parent: { threadId: "main", toolCallId: "review-fanout" },
    }),
    threadId: "review-thread",
  });
  // A process restart between reviewer creation and completion must preserve
  // the application-owned reviewer identity.
  harness.reducer = new LiveWorkflowReducer(harness.store);
  feed({
    ...event("THREAD_DONE", "review-done", {
      type: "thread.done",
      threadId: "review-thread",
      state: {
        status: "done",
        output: {
          content: JSON.stringify({
            verdict: "PASS",
            patchDigest: "a".repeat(64),
            criticalBlockers: [],
            summary: "No critical blockers.",
          }),
        },
      },
    }),
    threadId: "review-thread",
  });

  assert.equal(harness.state.reviewerVerdict, "PASS");
  assert.equal(
    harness.state.successCriteria.find((criterion) => criterion.id === "independent-review")?.status,
    "PASS",
  );
  assert.equal(harness.state.status, "ACTIVE");
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

  const record = createFeed(harness);
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
  const projector = new TrueForgeEventProjector(undefined, store);
  return {
    state: createSessionState(task, buildCiSuccessContract(task)),
    store,
    projector,
    reducer: new LiveWorkflowReducer(store, (callId) => projector.getToolCall(callId)),
    sequence: 0,
  };
}

function createFeed(harness: Harness): (event: RuntimeEvent) => void {
  return (runtimeEvent: RuntimeEvent): void => {
    harness.sequence += 1;
    runtimeEvent.sequenceNumber = harness.sequence;
    assert.equal(harness.store.recordEvent(runtimeEvent), true);
    harness.projector.project(harness.state, runtimeEvent);
    harness.reducer.apply(harness.state, runtimeEvent);
  };
}

function feedExactIncidentContext(
  harness: Harness,
  feed: (event: RuntimeEvent) => void,
  callId: string,
): void {
  feed(metaToolCall(callId, "github", "get_commit", {
    owner: "cmdr-chara",
    repo: "evidenceforge",
    sha: harness.state.task.revision,
  }));
  feed(toolResponse(callId, {
    success: true,
    response: {
      sha: harness.state.task.revision,
      repository: harness.state.task.repository,
      commit: { message: "workflow failure" },
    },
  }));
}

function feedExactReproduction(
  feed: (event: RuntimeEvent) => void,
  callId: string,
): void {
  feed(structuredCall(callId, "sandbox", "exec", {
    intent: "evidenceforge.verify:failure-reproduced",
    command: "node --test demo/incident-fixture/test/config.test.mjs",
    cwd: "/workspace/repository",
    timeoutSeconds: 180,
  }, "main", "truefoundry-system"));
  feed(toolResponse(callId, {
    success: true,
    response: { exitCode: 1, result: "CONFIG_VALIDATION_ORDER" },
  }));
}

function causalDiagnosticOutput(
  evidenceReferences = ["CONFIG_VALIDATION_ORDER", "runtime.ts:projectToolResult"],
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    findings: [
      "The adapter reports transport success independently from process exit status.",
    ],
    rootCauseHypotheses: [{
      id: "nonzero-exit-misclassification",
      cause:
        "The sandbox result adapter discards the authoritative non-zero process exit status.",
      causalMechanism:
        "The workflow observes a successful transport envelope and classifies the failed command as OK before checking its exit code.",
      affectedLocations: ["packages/trueforge/src/runtime.ts:projectToolResult"],
      evidenceReferences,
      status: "SUPPORTED",
    }],
    unresolvedQuestions: [],
  };
}

function feedDiagnosticEvidence(
  feed: (event: RuntimeEvent) => void,
  specialistIndex: number,
): void {
  const callId = `call-diagnostic-evidence-${specialistIndex}`;
  const threadId = `thread-${specialistIndex}`;
  feed(structuredCall(
    callId,
    "repository",
    "read",
    { path: "packages/trueforge/src/runtime.ts" },
    threadId,
    "truefoundry-system",
  ));
  feed(toolResponse(callId, {
    success: true,
    response: {
      result:
        "runtime.ts:projectToolResult checks transport status before process exit; CONFIG_VALIDATION_ORDER reproduces the failure",
    },
  }, threadId));
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

function diagnosticThreadDone(
  index: number,
  output?: Record<string, unknown>,
): RuntimeEvent {
  return {
    ...event("THREAD_DONE", `thread-done-${index}`, {
      type: "thread.done",
      threadId: `thread-${index}`,
      state: {
        status: "done",
        ...(output === undefined
          ? {}
          : { output: { content: JSON.stringify(output) } }),
      },
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

function metaToolCall(
  callId: string,
  serverName: string,
  name: string,
  args: Record<string, unknown>,
): RuntimeEvent {
  return event("MODEL_MESSAGE", `message-${callId}`, {
    type: "model.message",
    threadId: "main",
    toolCalls: [{
      id: callId,
      type: "function",
      function: {
        name: "call_tool",
        arguments: JSON.stringify({ mcp_server: serverName, tool_name: name, input: args }),
      },
      toolInfo: { type: "truefoundry-system", name: "call_tool" },
    }],
  });
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
