import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DIAGNOSTIC_OBSERVATION_MAX_CHARACTERS,
  DIAGNOSTIC_OUTPUT_MAX_CHARACTERS,
  DIAGNOSTIC_OUTPUT_PROTOCOL,
  DIAGNOSTIC_REFERENCE_MAX_CHARACTERS,
  DIAGNOSTIC_SPECIALISTS,
  parseDiagnosticSpecialistOutput,
} from "../../packages/specialists/src";
import { buildEvidenceForgeAgentSpec } from "../../packages/trueforge/src";

test("diagnostic output parser accepts a bounded causal claim", () => {
  const parsed = parseDiagnosticSpecialistOutput(diagnosticOutput());

  assert.equal(parsed?.rootCauseHypotheses[0]?.id, "nonzero-exit-misclassification");
  assert.equal(parsed?.rootCauseHypotheses[0]?.status, "SUPPORTED");
  assert.equal(parsed?.rootCauseHypotheses[0]?.evidenceReferences.length, 2);
});

test("diagnostic output parser uses field-specific structural bounds", () => {
  const observation = "x".repeat(DIAGNOSTIC_REFERENCE_MAX_CHARACTERS + 1);
  const accepted = diagnosticOutput();
  accepted.findings = [observation];
  accepted.unresolvedQuestions = [observation];
  assert.deepEqual(parseDiagnosticSpecialistOutput(accepted)?.findings, [observation]);
  assert.deepEqual(parseDiagnosticSpecialistOutput(accepted)?.unresolvedQuestions, [observation]);

  const oversizedObservation = diagnosticOutput();
  oversizedObservation.findings = [
    "x".repeat(DIAGNOSTIC_OBSERVATION_MAX_CHARACTERS + 1),
  ];
  assert.equal(parseDiagnosticSpecialistOutput(oversizedObservation), undefined);

  const oversizedReference = diagnosticOutput();
  oversizedReference.rootCauseHypotheses[0]!.evidenceReferences = [
    "x".repeat(DIAGNOSTIC_REFERENCE_MAX_CHARACTERS + 1),
  ];
  assert.equal(parseDiagnosticSpecialistOutput(oversizedReference), undefined);
});

test("diagnostic output parser rejects wrappers, coercions, and unknown fields", () => {
  const valid = diagnosticOutput();
  assert.equal(parseDiagnosticSpecialistOutput(JSON.stringify(valid)), undefined);
  assert.equal(parseDiagnosticSpecialistOutput({ output: valid }), undefined);
  assert.equal(
    parseDiagnosticSpecialistOutput({ ...valid, commentary: "causal prose" }),
    undefined,
  );
  assert.equal(
    parseDiagnosticSpecialistOutput({
      ...valid,
      rootCauseHypotheses: [],
      affectedLocations: ["packages/trueforge/src/verifier-projection.ts"],
      evidenceReferences: ["verifier-projection.ts"],
      status: "SUPPORTED",
    }),
    undefined,
  );
  assert.equal(
    parseDiagnosticSpecialistOutput({ ...valid, findings: "one observation" }),
    undefined,
  );
  assert.equal(
    parseDiagnosticSpecialistOutput({
      ...valid,
      rootCauseHypotheses: [{
        ...valid.rootCauseHypotheses[0]!,
        confidence: 0.99,
      }],
    }),
    undefined,
  );
});

test("diagnostic output parser rejects a symptom without a causal mechanism", () => {
  assert.equal(parseDiagnosticSpecialistOutput({
    schemaVersion: 1,
    findings: ["The command failed."],
    rootCauseHypotheses: [{
      id: "failure-observed",
      cause: "The command at the incident revision returns a non-zero exit status.",
      affectedLocations: ["test output"],
      evidenceReferences: ["CONFIG_VALIDATION_ORDER"],
      status: "SUPPORTED",
    }],
    unresolvedQuestions: [],
  }), undefined);
});

test("diagnostic output parser rejects duplicate or unbounded references", () => {
  const duplicate = {
    schemaVersion: 1,
    findings: [],
    rootCauseHypotheses: [{
      id: "duplicate-evidence",
      cause: "The result adapter ignores the authoritative non-zero process exit status.",
      causalMechanism:
        "The same evidence reference is repeated instead of identifying independently inspectable support.",
      affectedLocations: ["runtime.ts", "runtime.ts"],
      evidenceReferences: ["failure signature"],
      status: "SUPPORTED",
    }],
    unresolvedQuestions: [],
  };
  assert.equal(parseDiagnosticSpecialistOutput(duplicate), undefined);
});

test("diagnostic output parser rejects trivially short evidence references", () => {
  assert.equal(parseDiagnosticSpecialistOutput({
    schemaVersion: 1,
    findings: [],
    rootCauseHypotheses: [{
      id: "short-reference",
      cause: "The result adapter ignores the authoritative non-zero process exit status.",
      causalMechanism:
        "The workflow classifies the transport envelope before checking the process outcome.",
      affectedLocations: ["runtime.ts"],
      evidenceReferences: ["OK"],
      status: "SUPPORTED",
    }],
    unresolvedQuestions: [],
  }), undefined);
});

test("TrueForge supervisor and specialist definitions share the strict diagnostic contract", () => {
  const spec = buildEvidenceForgeAgentSpec({
    baseUrl: "http://localhost:8790",
    model: "test/model",
    githubMcpName: "github",
    timeoutInSeconds: 30,
  });

  assert.ok(spec.instructions.includes(DIAGNOSTIC_OUTPUT_PROTOCOL));
  assert.ok(spec.instructions.includes("must not restate the failure symptom as a cause"));
  assert.ok(spec.instructions.includes("rejects unresolved or cross-thread references"));
  assert.ok(DIAGNOSTIC_OUTPUT_PROTOCOL.includes("exactly the displayed keys"));
  assert.ok(
    DIAGNOSTIC_OUTPUT_PROTOCOL.includes(
      '"rootCauseHypotheses":[],"unresolvedQuestions":[]',
    ),
  );
  assert.ok(
    DIAGNOSTIC_OUTPUT_PROTOCOL.includes(
      "Do not move affectedLocations, evidenceReferences, or status to the top level",
    ),
  );
  assert.ok(
    DIAGNOSTIC_OUTPUT_PROTOCOL.includes(
      `serialized JSON object must not exceed ${DIAGNOSTIC_OUTPUT_MAX_CHARACTERS} characters`,
    ),
  );
  assert.ok(DIAGNOSTIC_OUTPUT_PROTOCOL.includes("does not truncate, rewrite, infer, or reclassify"));
  for (const specialist of DIAGNOSTIC_SPECIALISTS) {
    assert.ok(specialist.instructions.includes(DIAGNOSTIC_OUTPUT_PROTOCOL));
  }
});

function diagnosticOutput() {
  return {
    schemaVersion: 1,
    findings: ["The adapter reports transport success independently from process exit status."],
    rootCauseHypotheses: [{
      id: "nonzero-exit-misclassification",
      cause: "The sandbox result adapter discards the authoritative non-zero process exit status.",
      causalMechanism:
        "The workflow observes a successful transport envelope and classifies the failed command as OK before checking its exit code.",
      affectedLocations: ["packages/trueforge/src/runtime.ts:projectToolResult"],
      evidenceReferences: ["CONFIG_VALIDATION_ORDER", "runtime.ts:projectToolResult"],
      status: "SUPPORTED",
    }],
    unresolvedQuestions: [] as string[],
  };
}
