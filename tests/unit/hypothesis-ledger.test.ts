import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeEvent } from "../../packages/domain/src";
import { createEvidence, EvidenceStore } from "../../packages/evidence/src";
import { HypothesisLedger } from "../../packages/workflow/src";

function evidenceStore(): EvidenceStore {
  const store = new EvidenceStore();
  const event: RuntimeEvent = {
    id: "event-1",
    type: "TOOL_RESULT",
    source: "github-mcp",
    timestamp: new Date().toISOString(),
    payload: {},
  };
  store.recordEvent(event);
  store.recordEvidence(
    createEvidence({
      id: "ev-1",
      kind: "OBSERVATION",
      sourceEventId: event.id,
      sourceTool: "github-mcp.get-run",
      claim: "secret is present and masked",
      outcome: "PASS",
    }),
  );
  return store;
}

test("incorrect hypothesis is refuted only with evidence", () => {
  const ledger = new HypothesisLedger(evidenceStore());
  ledger.open("H1", "missing CI secret");
  const refuted = ledger.refute("H1", ["ev-1"]);
  assert.equal(refuted.status, "REFUTED");
  assert.deepEqual(refuted.contradictingEvidence, ["ev-1"]);
});

test("hypothesis cannot be supported by an unknown evidence ID", () => {
  const ledger = new HypothesisLedger(evidenceStore());
  ledger.open("H2", "dependency regression");
  assert.throws(() => ledger.support("H2", ["missing"]));
});
