import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import {
  createSessionState,
  createTask,
  type RuntimeEvent,
} from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { parseDiagnosticSpecialistOutput } from "../../packages/specialists/src";
import { buildCiSuccessContract } from "../../packages/workflow/src";
import { LiveWorkflowReducer } from "../../apps/server/src/live-workflow";
import lunaRetryThreadCreatedFixture from "../fixtures/live-diagnostics/luna-retry-thread-created.json";
import lunaRetryThreadDoneFixture from "../fixtures/live-diagnostics/luna-retry-thread-done.json";
import {
  LUNA_RETRY_NONZERO_TOOL_RESULT_GZIP_BASE64,
  LUNA_RETRY_NONZERO_TOOL_RESULT_SHA256,
} from "../fixtures/live-diagnostics/luna-retry-nonzero-tool-result";
import {
  LUNA_RETRY_SUCCESS_TOOL_RESULT_GZIP_BASE64,
  LUNA_RETRY_SUCCESS_TOOL_RESULT_SHA256,
} from "../fixtures/live-diagnostics/luna-retry-success-tool-result";

test("Luna retry remains fail closed when a cause cites non-zero command output", () => {
  const task = createTask({
    id: "task-luna-diagnostic-regression",
    objective: "Reproduce the profiled configuration-order repair",
    repository: "cmdr-chara/evidenceforge",
    revision: "9accc9e484e055c8b22172e389dc50f84315f4e2",
    runId: "32892119950",
    createdAt: "2026-08-29T10:26:38.867Z",
  });
  const state = createSessionState(task, buildCiSuccessContract(task));
  const store = new EvidenceStore();
  const reducer = new LiveWorkflowReducer(store);
  const recordedEvents = [
    runtimeEventFromFixture(lunaRetryThreadCreatedFixture),
    runtimeEventFromCompressedFixture(
      LUNA_RETRY_NONZERO_TOOL_RESULT_GZIP_BASE64,
      LUNA_RETRY_NONZERO_TOOL_RESULT_SHA256,
    ),
    runtimeEventFromCompressedFixture(
      LUNA_RETRY_SUCCESS_TOOL_RESULT_GZIP_BASE64,
      LUNA_RETRY_SUCCESS_TOOL_RESULT_SHA256,
    ),
    runtimeEventFromFixture(lunaRetryThreadDoneFixture),
  ];

  const doneOutput = parseDiagnosticSpecialistOutput(
    readThreadDoneOutput(recordedEvents[3]),
  );
  assert.ok(doneOutput);
  assert.ok(
    doneOutput.rootCauseHypotheses[0]?.evidenceReferences.includes("'OK' !== 'ERROR'"),
  );

  const failedCommand = readToolResponse(recordedEvents[1]);
  assert.equal(failedCommand.success, true);
  assert.equal(asRecord(failedCommand.response).exitCode, 1);

  for (const event of recordedEvents) {
    assert.equal(store.recordEvent(event), true);
    reducer.apply(state, event);
  }

  assert.equal(state.status, "BLOCKED");
  assert.equal(state.phase, "BLOCKED");
  assert.match(
    state.blockedReason ?? "",
    /cited evidence that was not observed in its specialist thread/,
  );
  assert.equal(state.hypotheses.length, 0);
  assert.equal(state.evidenceIds.length, 0);
  assert.equal(store.listEvidence().length, 0);
  assert.equal(state.completionCertificate, undefined);
});

function runtimeEventFromCompressedFixture(
  gzipBase64: string,
  expectedSha256: string,
): RuntimeEvent {
  const bytes = gunzipSync(Buffer.from(gzipBase64, "base64"));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    expectedSha256,
    "compressed fixture must reproduce the exact sanitized runtime event bytes",
  );
  return runtimeEventFromFixture(JSON.parse(bytes.toString("utf8")) as unknown);
}

function runtimeEventFromFixture(value: unknown): RuntimeEvent {
  return structuredClone(value) as RuntimeEvent;
}

function readThreadDoneOutput(event: RuntimeEvent | undefined): unknown {
  if (event === undefined) assert.fail("missing THREAD_DONE fixture");
  const payload = asRecord(event.payload);
  const state = asRecord(payload.state);
  const output = asRecord(state.output);
  const content = output.content;
  if (typeof content !== "string") assert.fail("fixture lacks THREAD_DONE output content");
  return JSON.parse(content) as unknown;
}

function readToolResponse(event: RuntimeEvent | undefined): Record<string, unknown> {
  if (event === undefined) assert.fail("missing TOOL_RESULT fixture");
  const content = asRecord(event.payload).content;
  if (typeof content !== "string") assert.fail("fixture lacks TOOL_RESULT content");
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) assert.fail("tool result content is not one JSON object");
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
