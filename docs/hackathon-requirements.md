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
- Credentialed TrueForge/model and GitHub MCP read observations now exist, as do separate Daytona connectivity/exec observations. A single end-to-end failing-revision → approval → PR → reconciliation run remains an external gate.

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
- final exact-SHA request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5440874929
- current finding triage: `docs/qodo-review-log.md`

Qodo updated its aggregate review against final SHA `7555f0f01f1af1f198d665333098619d05408230`. It marks the implementable findings resolved and retains one open High: the pre-execution read-only boundary that TrueForge SDK `0.1.3` cannot currently enforce per dynamic subagent.

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

Last externally verified baseline SHA `7555f0f01f1af1f198d665333098619d05408230` passed GitHub Actions runs `33084240703` and `33084235854` with:

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

This proves that baseline repository candidate, not the newer unpublished candidate or a full sponsor-infrastructure vertical slice. The newer candidate passes the equivalent local gates with 193/193 tests and still requires exact-head CI after publication.

Observed live component evidence:

- TrueForge session `01m11zp6dfp08dq520eqsp9cdx` and model turn `01m11zp6dyt1xq08qwdkzdns1h.local`;
- official GitHub MCP `get_commit` returned exact SHA `7555f0f0…` inside that turn;
- Daytona connectivity and a successful command execution were observed separately;
- the configured skills and dynamic-subagent/approval surfaces were observed in a credentialed session.

These observations do not satisfy the still-open exact failing-revision reproduction, live approval/PR write, reconciliation, or CompletionGate path.

## UI evidence boundary

Responsive/a11y code supports small viewports, reduced motion, task-scoped SSE, accessible logs/live regions, focus visibility, long-value labels, and >=44px primary controls. The exact **320 / 375 / 768 / 1024 / 1440 px** widths were observed without page-level horizontal overflow; the narrow phase rail remains intentionally scrollable. Exact browser **200% zoom** remains manual because the available browser-control surface does not expose zoom. A 640px equivalent reflow was clean but is not represented as exact zoom evidence.

## External/human prerequisites still open

- exact failing-run/revision selection and a reproducible signature;
- a single durable run through GitHub context, Daytona reproduction, verification, and approval;
- real `tool.approval_required` pause/resume;
- EvidenceForge-created real PR + exact reconciliation;
- exact 200% browser zoom check;
- demo video/publication;
- human merge and official submission.

No sponsor result, Qodo closure, merge, or submission is represented as complete without observed evidence.
