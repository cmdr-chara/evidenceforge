import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEvidenceForgeAgentSpec,
  TRUEFORGE_LLM_ITERATION_LIMIT,
  TRUEFORGE_MAX_OUTPUT_TOKENS,
  TRUEFORGE_REASONING_EFFORT,
  TRUEFORGE_SPECIALIST_REQUESTED_TOOL_BUDGET,
  TRUEFORGE_SPECIALIST_TOOL_BUDGET,
} from "../../packages/trueforge/src";

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

test("TrueForge agent spec bounds per-thread work and requires convergence", () => {
  const spec = buildEvidenceForgeAgentSpec({
    baseUrl: "http://localhost:8790",
    model: "deepseek/deepseek-v-4-flash",
    githubMcpName: "github",
    timeoutInSeconds: 600,
  });

  assert.equal(spec.config.iteration_limit, TRUEFORGE_LLM_ITERATION_LIMIT);
  assert.equal(TRUEFORGE_LLM_ITERATION_LIMIT, 36);
  assert.equal(spec.model.params.max_tokens, TRUEFORGE_MAX_OUTPUT_TOKENS);
  assert.equal(TRUEFORGE_MAX_OUTPUT_TOKENS, 4_096);
  assert.equal(spec.model.params.parallel_tool_calls, true);
  assert.equal(spec.model.params.reasoning_effort, TRUEFORGE_REASONING_EFFORT);
  assert.equal(TRUEFORGE_REASONING_EFFORT, "high");
  assert.equal(TRUEFORGE_SPECIALIST_REQUESTED_TOOL_BUDGET, 12);
  assert.equal(TRUEFORGE_SPECIALIST_TOOL_BUDGET, 20);
  assert.match(
    spec.instructions,
    new RegExp(`at most ${TRUEFORGE_SPECIALIST_REQUESTED_TOOL_BUDGET} tool calls`),
  );
  assert.match(spec.instructions, /launch the three named specialists immediately in one parallel fan-out/i);
  assert.match(spec.instructions, /Do not repeat a semantically identical tool call/i);
  assert.match(spec.instructions, /Never poll a child thread, auto-resume a timed-out turn/i);
  assert.match(spec.instructions, /Only the initial diagnostic fan-out may be parallel/i);
  assert.match(spec.instructions, /supervisor response below 1,200 words/i);
});
