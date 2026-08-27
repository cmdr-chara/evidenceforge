import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(process.cwd());
const doctor = resolve(root, "scripts/doctor.mjs");

test("doctor blocks missing runtime configuration locally", () => {
  const result = runDoctor({
    CI: undefined,
    TRUEFORGE_BASE_URL: "",
    TRUEFORGE_MODEL: "",
  });
  assert.equal(result.status, 1);
  assert.match(result.output, /Doctor mode: local\/live readiness/);
  assert.match(result.output, /BLOCKED TrueForge base URL configured/);
  assert.match(result.output, /BLOCKED model configured/);
});

test("doctor accepts explicit inert CI placeholders without implying connectivity", () => {
  const result = runDoctor({
    CI: "true",
    TRUEFORGE_BASE_URL: "http://127.0.0.1:8790",
    TRUEFORGE_MODEL: "ci/placeholder",
  });
  assert.equal(result.status, 0);
  assert.match(result.output, /Doctor mode: CI contract \(placeholders permitted\)/);
  assert.match(result.output, /PASS TrueForge base URL configured/);
  assert.match(result.output, /PASS model configured/);
});

function runDoctor(overrides: Record<string, string | undefined>) {
  const environment = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  const result = spawnSync(process.execPath, [doctor], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}
