import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSessionState,
  createTask,
  RuntimeEvent,
  SessionState,
} from "../../packages/domain/src";
import { EvidenceStore } from "../../packages/evidence/src";
import { parseDiagnosticSpecialistOutput } from "../../packages/specialists/src";
import { buildCiSuccessContract } from "../../packages/workflow/src";
import {
  DiagnosticOutputError,
  projectDiagnosticRootCauseClaims,
} from "../../apps/server/src/live-root-cause";
import {
  diagnosticOutputFrom,
  LIVE_DIAGNOSTIC_EVENT_IDS,
  LiveDiagnosticRunFixture,
  loadLiveDiagnosticRunFixture,
  requiredRuntimeEvent,
} from "../fixtures/live-diagnostic-runs";

const UNOBSERVED_REFERENCE_ERROR =
  "diagnostic cause cited evidence that was not observed in its specialist thread";

test("real Luna and Sol THREAD_DONE outputs preserve bounded observations exactly", () => {
  for (const fixture of [
    {
      run: "luna-schema" as const,
      eventId: LIVE_DIAGNOSTIC_EVENT_IDS.lunaSchemaDone,
      findingIndex: 0,
      expectedLength: 258,
    },
    {
      run: "sol-schema" as const,
      eventId: LIVE_DIAGNOSTIC_EVENT_IDS.solSchemaDone,
      findingIndex: 4,
      expectedLength: 264,
    },
  ]) {
    const events = loadLiveDiagnosticRunFixture(fixture.run);
    const done = requiredRuntimeEvent(events, fixture.eventId);
    const rawOutput = diagnosticOutputFrom(done);
    const parsed = parseDiagnosticSpecialistOutput(rawOutput);

    assert.ok(parsed);
    assert.deepEqual(parsed, rawOutput);
    assert.equal(requiredFinding(rawOutput, fixture.findingIndex).length, fixture.expectedLength);
  }
});

test("real Sol events project causal evidence without changing its claim", () => {
  const events = loadLiveDiagnosticRunFixture("sol-schema");
  const done = requiredRuntimeEvent(events, LIVE_DIAGNOSTIC_EVENT_IDS.solSchemaDone);
  const rawOutput = diagnosticOutputFrom(done);
  const store = recordEvents(events);
  const state = createDiagnosticState();

  const projected = projectDiagnosticRootCauseClaims(
    state,
    done,
    "Dependency / Configuration Investigator",
    store,
  );

  assert.equal(projected, 1);
  assert.equal(state.status, "ACTIVE");
  assert.equal(state.hypotheses.length, 1);
  const rawClaims = rawOutput.rootCauseHypotheses;
  assert.ok(Array.isArray(rawClaims));
  const rawClaim = asRecord(rawClaims[0]);
  assert.equal(
    state.hypotheses[0]?.statement,
    `${rawClaim.cause as string} Causal mechanism: ${rawClaim.causalMechanism as string}`,
  );
  assert.equal(state.hypotheses[0]?.status, "OPEN");

  const evidenceId = `live-${done.id}-diagnostic-root-cause-1`;
  const evidence = store.getEvidence(evidenceId);
  assert.ok(evidence);
  assert.equal(evidence.metadata?.reportedStatus, "SUPPORTED");
  assert.equal(evidence.metadata?.resolvedEvidenceCount, 3);
  assert.deepEqual(evidence.artifactRefs, [
    "runtime-event://01m16jgexqptsw1ew987rgjf6e",
    "runtime-event://01m16jgmeqgxjsbvjwa8m3aadx",
    "runtime-event://01m16jh2t1hafefjx783fdsecy",
  ]);
});

test("real Luna output passes structural parsing but still rejects unobserved references", () => {
  const events = loadLiveDiagnosticRunFixture("luna-schema");
  const done = requiredRuntimeEvent(events, LIVE_DIAGNOSTIC_EVENT_IDS.lunaSchemaDone);
  assert.ok(parseDiagnosticSpecialistOutput(diagnosticOutputFrom(done)));

  assertUnobservedReferenceRejection(
    events,
    done,
    "Repository Investigator",
  );
});

test("real Luna retry ignores a cited string that appears only in a failed tool result", () => {
  const events = loadLiveDiagnosticRunFixture("luna-unobserved-reference");
  const failedResult = requiredRuntimeEvent(
    events,
    LIVE_DIAGNOSTIC_EVENT_IDS.lunaUnobservedFailedResult,
  );
  const failedPayload = asRecord(JSON.parse(requiredToolResultContent(failedResult)) as unknown);
  const failedResponse = asRecord(failedPayload.response);
  assert.equal(failedResponse.exitCode, 1);
  assert.match(String(failedResponse.result), /'OK' !== 'ERROR'/);

  const done = requiredRuntimeEvent(events, LIVE_DIAGNOSTIC_EVENT_IDS.lunaUnobservedDone);
  assert.ok(parseDiagnosticSpecialistOutput(diagnosticOutputFrom(done)));
  assertUnobservedReferenceRejection(
    events,
    done,
    "Repository Investigator",
  );
});

function assertUnobservedReferenceRejection(
  events: RuntimeEvent[],
  done: RuntimeEvent,
  specialistName: string,
): void {
  const store = recordEvents(events);
  const state = createDiagnosticState();
  const before = structuredClone(state);

  assert.throws(
    () => projectDiagnosticRootCauseClaims(state, done, specialistName, store),
    (error: unknown) =>
      error instanceof DiagnosticOutputError &&
      error.message === UNOBSERVED_REFERENCE_ERROR,
  );
  assert.deepEqual(state, before);
  assert.equal(store.listEvidence().length, 0);
}

function recordEvents(events: RuntimeEvent[]): EvidenceStore {
  const store = new EvidenceStore();
  for (const event of events) assert.equal(store.recordEvent(event), true);
  return store;
}

function createDiagnosticState(): SessionState {
  const task = createTask({
    id: "task-live-diagnostic-run-regression",
    objective: "Resolve the preserved live CI failure",
    repository: "cmdr-chara/evidenceforge",
    revision: "9accc9e",
    runId: "preserved-live-run",
    createdAt: "2026-08-29T10:00:00.000Z",
  });
  return createSessionState(task, buildCiSuccessContract(task));
}

function requiredFinding(output: Record<string, unknown>, index: number): string {
  const findings = output.findings;
  if (!Array.isArray(findings) || typeof findings[index] !== "string") {
    throw new Error(`missing finding ${index}`);
  }
  return findings[index];
}

function requiredToolResultContent(event: RuntimeEvent): string {
  const content = asRecord(event.payload).content;
  if (typeof content !== "string") {
    throw new Error(`runtime event ${event.id} has no tool result content`);
  }
  return content;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
