import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionController } from "../../packages/workflow/src";
import { buildState } from "../fixtures/builders";

test("workflow follows explicit legal transitions", () => {
  const controller = new SessionController(buildState());
  assert.equal(controller.transition("DEFINE_SUCCESS", "APPLICATION", "intake complete").phase, "DEFINE_SUCCESS");
  assert.equal(controller.transition("PLANNING", "APPLICATION", "contract defined").phase, "PLANNING");
  assert.equal(controller.transition("INVESTIGATING", "APPLICATION", "plan ready").phase, "INVESTIGATING");
});

test("illegal phase skip is rejected", () => {
  const controller = new SessionController(buildState());
  assert.throws(() => controller.transition("PATCHING", "APPLICATION", "skip evidence"));
});

test("model cannot directly set terminal failure states", () => {
  const controller = new SessionController(buildState());
  assert.throws(() => controller.transition("BLOCKED", "MODEL", "model opinion"));
});
