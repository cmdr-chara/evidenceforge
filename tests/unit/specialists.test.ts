import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDiagnosticTopology,
  DIAGNOSTIC_SPECIALISTS,
  INDEPENDENT_REVIEWER,
} from "../../packages/specialists/src";

test("exactly three diagnostic specialists are configured", () => {
  assert.equal(DIAGNOSTIC_SPECIALISTS.length, 3);
  assert.doesNotThrow(() => assertDiagnosticTopology(DIAGNOSTIC_SPECIALISTS));
});

test("parallel diagnostics are read-only and patching remains outside fan-out", () => {
  for (const specialist of DIAGNOSTIC_SPECIALISTS) {
    assert.equal(specialist.readOnly, true);
    assert.ok(specialist.forbiddenCapabilities.includes("file write"));
    assert.ok(specialist.forbiddenCapabilities.includes("patch"));
  }
});

test("reviewer receives isolated context rather than patching transcript", () => {
  assert.ok(INDEPENDENT_REVIEWER.excludes.includes("patching transcript"));
  assert.ok(INDEPENDENT_REVIEWER.receives.includes("verifier results"));
});
