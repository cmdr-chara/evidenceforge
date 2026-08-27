# Agent Harness Hackathon requirements

**Last synchronized with repository evidence:** 2026-08-27

This document records requirements that affect EvidenceForge. Official live sources override the original build prompt when they differ.

## Official sources

- Hackathon page: https://www.wemakedevs.org/hackathons/trueforge
- Kick-off and rules: https://www.wemakedevs.org/blogs/agent-harness-hackathon-kick-off
- TrueForge repository: https://github.com/truefoundry/trueforge
- TrueForge documentation: https://trueforge.dev
- TrueForge SDK: https://trueforge.dev/api/overview
- Qodo documentation: https://docs.qodo.ai/
- Model Context Protocol specification: https://modelcontextprotocol.io/specification/2026-07-28
- Daytona documentation: https://www.daytona.io/docs/

## Deadline and event window

- Event window: August 24–30, 2026.
- Official closing time observed: **August 30, 2026 at 20:00 Europe/London**, equivalent to **21:00 Europe/Rome** on that date.
- Submission policy: freeze features and preserve a buffer before the closing time.

## Mandatory product requirements

1. The submitted agent must run on TrueForge, and TrueForge must visibly perform real work.
2. The repository must be public and include reproducible setup instructions.
3. The submission needs a short demo video, approximately three minutes, plus a concise project write-up.
4. Sponsor usage must be demonstrable rather than asserted.
5. AI coding assistance must be disclosed.

### Current implementation status

- `@truefoundry/trueforge-sdk` `0.1.3` is the live integration boundary.
- GitHub MCP, Daytona sandboxing, skills, approvals, compaction, dynamic subagents, and bounded iterations are configured in the TrueForge agent specification.
- The UI clearly separates deterministic fixture mode from live sponsor-infrastructure mode.
- Deterministic/live-missing checks fail closed; fixture evidence is never substituted for sponsor evidence.
- Credentialed live TrueForge + model + GitHub MCP + Daytona execution remains an external gate.

## Qodo code-quality requirements

Observed rules require:

1. substantive work through a GitHub pull request;
2. Qodo Agentic Review before merge;
3. `/agentic_review` when automatic review is absent;
4. every valid High finding fixed, or an explicit rationale when genuinely blocked/disputed;
5. Qodo re-run after corrective changes;
6. a human merge;
7. public Qodo evidence linked from submission documentation.

### Current Qodo status

Qodo Agentic Review is genuinely observed on PR #2:

- aggregate review: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- earlier follow-up request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5428521720
- current finding triage: `docs/qodo-review-log.md`

The reconstructed batch contains implementation/tests for every currently implementable open High/Medium finding. Qodo has **not yet re-reviewed the final reconstructed SHA**, so repository-side `FIXED` does not imply Qodo-side resolved status.

## TrueForge SDK 0.1.3 specialist-isolation limitation

The installed SDK declarations were inspected directly. Relevant facts:

- `RuntimeConfig.dynamicSubAgents` accepts `DynamicSubAgentsConfig`;
- `DynamicSubAgentsConfig` exposes enablement only;
- dynamic `AgentInfo` exposes input/model/name/type metadata;
- the agent spec exposes the parent tool/MCP/sandbox configuration;
- no per-dynamic-subagent pre-execution tool allowlist or interceptor is exposed.

Therefore EvidenceForge cannot truthfully enforce a read-only tool capability boundary **before execution** for individual dynamic subagents using SDK `0.1.3`. Prompt instructions and post-event rejection are not equivalent to prevention. P0.4 is recorded as **BLOCKED by the SDK surface**.

The minimum safe architecture is a TrueForge-supported future per-subagent tool policy, or a narrow read-only proxy/tool surface made available to specialists while mutation remains parent-owned and serialized. EvidenceForge does not introduce another orchestration framework.

## Current TrueForge interface facts

- TypeScript SDK: `@truefoundry/trueforge-sdk`, version `0.1.3` in this repository.
- Required Node version: `>=22.14.0`.
- Human tool pauses emit `tool.approval_required`; resume uses `user.tool_approval`.
- Durable reconnect uses session ID, turn ID, sequence number, `getTurn`, `subscribeToTurn`, and `listTurnEvents`.
- Skills are git-backed `SKILL.md` packs and require sandboxing.
- Daytona is the currently configured/documented sandbox provider.
- Dynamic subagents share the parent's available runtime capabilities; one-level fan-out is used.
- Context compaction and large-result handling are part of the agent specification.

## MCP security facts

Tool annotations are useful metadata, not an authorization oracle. EvidenceForge retains its own trusted risk registry and does not let repository/issue/log/tool content downgrade action risk.

## Verified repository evidence

Implementation SHA `628d4db9a19e50b142051fe3ae2793b0b9b704ad` passed GitHub Actions run `33083635762` with:

- `pnpm install --frozen-lockfile`;
- format check;
- lint;
- TypeScript typecheck;
- 159/159 tests;
- evaluation smoke;
- demo fixture;
- build;
- doctor;
- `git diff --check`.

This proves the deterministic repository candidate, not live sponsor infrastructure.

## UI evidence boundary

Responsive/a11y code supports small viewports, reduced motion, task-scoped SSE, accessible logs/live regions, focus visibility, long-value labels, and >=44px primary controls. The requested exact **320 / 375 / 768 / 1024 / 1440 px and 200% zoom browser matrix has not been visually observed** in the available execution environment. It remains a manual demo/readiness check.

## External/human prerequisites still open

- reachable TrueForge server and model credentials;
- GitHub MCP credentials inside TrueForge;
- Daytona credentials inside TrueForge;
- live skill materialization;
- real `tool.approval_required` pause/resume;
- EvidenceForge-created real PR + exact reconciliation;
- final Qodo Agentic Review on the exact candidate SHA;
- exact viewport/200% visual check;
- demo video/publication;
- human merge and official submission.

No sponsor result, Qodo closure, merge, or submission is represented as complete without observed evidence.
