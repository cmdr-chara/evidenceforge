import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeEvent } from "../../packages/domain/src";
import { createEvidence, EvidenceStore } from "../../packages/evidence/src";
import { SpecialistAggregator } from "../../packages/specialists/src";

function addEvidence(store: EvidenceStore, id: string): void {
  const event: RuntimeEvent = {
    id: `event-${id}`,
    type: "TOOL_RESULT",
    source: "fixture",
    timestamp: new Date().toISOString(),
    payload: {},
  };
  store.recordEvent(event);
  store.recordEvidence(
    createEvidence({
      id,
      kind: "OBSERVATION",
      sourceEventId: event.id,
      sourceTool: "github-mcp.search",
      claim: "bounded observation",
      outcome: "PASS",
    }),
  );
}

test("specialist timeout preserves partial results and reports missing agent", () => {
  const store = new EvidenceStore();
  addEvidence(store, "ev-repo");
  addEvidence(store, "ev-log");
  const aggregate = new SpecialistAggregator(store).aggregate([
    {
      agent: "Repository Investigator",
      findings: ["validation occurs before fallback"],
      hypotheses: ["validation-order regression"],
      evidenceIds: ["ev-repo"],
      unresolvedQuestions: [],
    },
    {
      agent: "Failure / Log Investigator",
      findings: ["stable signature found"],
      hypotheses: ["validation-order regression"],
      evidenceIds: ["ev-log"],
      unresolvedQuestions: [],
    },
  ]);
  assert.deepEqual(aggregate.missingAgents, ["Dependency / Configuration Investigator"]);
  assert.equal(aggregate.hypotheses[0]?.status, "SUPPORTED");
});
