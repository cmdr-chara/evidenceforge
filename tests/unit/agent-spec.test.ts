import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvidenceForgeAgentSpec } from "../../packages/trueforge/src";

test("TrueForge agent spec enables sponsor primitives centrally", () => {
  const spec = buildEvidenceForgeAgentSpec({
    baseUrl: "http://localhost:8790",
    model: "openai/gpt-5.2",
    githubMcpName: "github",
    timeoutInSeconds: 600,
  });
  assert.equal(spec.config.sandbox.enabled, true);
  assert.equal(spec.config.dynamic_sub_agents.enabled, true);
  assert.equal(spec.config.context_management.compaction.enabled, true);
  assert.equal(spec.mcp_servers[0]?.name, "github");
  assert.deepEqual(spec.mcp_servers[0]?.require_approval_for_tools, ["@write", "@destructive"]);
  assert.equal(spec.skills.length, 4);
});
