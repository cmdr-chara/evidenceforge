import assert from "node:assert/strict";
import { test } from "node:test";
import { type RuntimeEvent } from "../../packages/domain/src";
import {
  DIAGNOSTIC_OUTPUT_PROTOCOL,
  DIAGNOSTIC_REFERENCE_MAX_CHARACTERS,
  DIAGNOSTIC_TEXT_MAX_CHARACTERS,
  parseDiagnosticSpecialistOutput,
} from "../../packages/specialists/src";
import { normalizeTrueForgeEvent } from "../../packages/trueforge/src";
import lunaThreadDoneFixture from "../fixtures/live-diagnostics/luna-schema-thread-done.json";
import solThreadDoneFixture from "../fixtures/live-diagnostics/sol-schema-thread-done.json";

for (const regression of [
  {
    run: "Luna",
    fixture: lunaThreadDoneFixture,
    findingIndex: 0,
    findingLength: 258,
  },
  {
    run: "Sol",
    fixture: solThreadDoneFixture,
    findingIndex: 4,
    findingLength: 264,
  },
] as const) {
  test(`${regression.run} THREAD_DONE keeps its real diagnostic JSON through normalization`, () => {
    const recorded = runtimeEventFromFixture(regression.fixture);
    const normalized = normalizeTrueForgeEvent(
      recorded.payload,
      recorded.sequenceNumber,
      recorded.timestamp,
    ).event;

    assert.equal(normalized.id, recorded.id);
    assert.equal(normalized.type, "THREAD_DONE");
    assert.equal(normalized.threadId, recorded.threadId);
    assert.equal(readThreadDoneContent(normalized), readThreadDoneContent(recorded));

    const rawOutput = readThreadDoneOutput(normalized);
    const output = parseDiagnosticSpecialistOutput(rawOutput);
    assert.ok(output);
    const rawFinding = readStringArrayItem(rawOutput, "findings", regression.findingIndex);
    assert.equal(rawFinding.length, regression.findingLength);
    assert.equal(output.findings[regression.findingIndex], rawFinding);
    assert.equal(output.rootCauseHypotheses.length, 1);
  });
}

test("diagnostic parser applies narrative and reference limits to their own fields", () => {
  const oversizedFinding = readThreadDoneOutput(runtimeEventFromFixture(lunaThreadDoneFixture));
  oversizedFinding.findings = ["x".repeat(DIAGNOSTIC_TEXT_MAX_CHARACTERS + 1)];
  assert.equal(parseDiagnosticSpecialistOutput(oversizedFinding), undefined);

  const oversizedQuestion = readThreadDoneOutput(runtimeEventFromFixture(lunaThreadDoneFixture));
  oversizedQuestion.unresolvedQuestions = [
    "x".repeat(DIAGNOSTIC_TEXT_MAX_CHARACTERS + 1),
  ];
  assert.equal(parseDiagnosticSpecialistOutput(oversizedQuestion), undefined);

  const oversizedLocation = readThreadDoneOutput(runtimeEventFromFixture(lunaThreadDoneFixture));
  firstRootCauseClaim(oversizedLocation).affectedLocations = [
    "x".repeat(DIAGNOSTIC_REFERENCE_MAX_CHARACTERS + 1),
  ];
  assert.equal(parseDiagnosticSpecialistOutput(oversizedLocation), undefined);

  const oversizedReference = readThreadDoneOutput(runtimeEventFromFixture(lunaThreadDoneFixture));
  firstRootCauseClaim(oversizedReference).evidenceReferences = [
    "x".repeat(DIAGNOSTIC_REFERENCE_MAX_CHARACTERS + 1),
  ];
  assert.equal(parseDiagnosticSpecialistOutput(oversizedReference), undefined);
});

test("diagnostic parser rejects fields outside the exact JSON contract", () => {
  const topLevelProse = readThreadDoneOutput(runtimeEventFromFixture(lunaThreadDoneFixture));
  topLevelProse.commentary = "This prose is outside the causal evidence contract.";
  assert.equal(parseDiagnosticSpecialistOutput(topLevelProse), undefined);

  const claimProse = readThreadDoneOutput(runtimeEventFromFixture(lunaThreadDoneFixture));
  firstRootCauseClaim(claimProse).commentary =
    "This prose is outside the root-cause claim contract.";
  assert.equal(parseDiagnosticSpecialistOutput(claimProse), undefined);
});

test("diagnostic protocol exposes the exact structural and evidence-source bounds", () => {
  assert.match(DIAGNOSTIC_OUTPUT_PROTOCOL, /1-1024 characters/);
  assert.match(DIAGNOSTIC_OUTPUT_PROTOCOL, /8-256 characters/);
  assert.match(DIAGNOSTIC_OUTPUT_PROTOCOL, /non-zero command exit/);
  assert.match(DIAGNOSTIC_OUTPUT_PROTOCOL, /return an empty rootCauseHypotheses array/);
});

function runtimeEventFromFixture(value: unknown): RuntimeEvent {
  return structuredClone(value) as RuntimeEvent;
}

function readThreadDoneContent(event: RuntimeEvent): string {
  const payload = asRecord(event.payload);
  const state = asRecord(payload.state);
  const output = asRecord(state.output);
  const content = output.content;
  if (typeof content !== "string") assert.fail("fixture lacks THREAD_DONE output content");
  return content;
}

function readThreadDoneOutput(event: RuntimeEvent): Record<string, unknown> {
  const parsed = JSON.parse(readThreadDoneContent(event)) as unknown;
  if (!isRecord(parsed)) assert.fail("fixture output is not one JSON object");
  return structuredClone(parsed);
}

function readStringArrayItem(
  value: Record<string, unknown>,
  field: string,
  index: number,
): string {
  const array = value[field];
  if (!Array.isArray(array)) assert.fail(`${field} is not an array`);
  const item = array[index];
  if (typeof item !== "string") assert.fail(`${field}[${index}] is not a string`);
  return item;
}

function firstRootCauseClaim(output: Record<string, unknown>): Record<string, unknown> {
  const claims = output.rootCauseHypotheses;
  if (!Array.isArray(claims) || !isRecord(claims[0])) {
    assert.fail("fixture lacks a root-cause claim");
  }
  return claims[0];
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
