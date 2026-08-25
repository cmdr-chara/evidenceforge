# Agent Harness Hackathon requirements

**Last checked:** 2026-08-25T18:28:59Z / 2026-08-25T20:28:59+02:00

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
- Official closing time observed: **August 30, 2026 at 20:00 Europe/London**, which is **19:00 UTC / 21:00 Europe/Rome** on that date.
- Submission buffer policy: feature freeze well before the official closing time.

## Mandatory product requirements

1. The submitted agent must run on TrueForge, and TrueForge must visibly perform real work.
2. The repository must be public and include clear setup instructions.
3. The submission needs a short demo video, approximately three minutes, plus a concise project write-up.
4. Sponsor usage must be demonstrable rather than asserted.
5. AI coding assistance must be disclosed.

### Implementation impact

- `@truefoundry/trueforge-sdk` is the live integration boundary.
- The agent spec enables GitHub MCP, Daytona sandboxing, dynamic subagents, skills, approvals, compaction, large-result offloading, and bounded iterations.
- The UI distinguishes deterministic fixture mode from live sponsor-infrastructure mode.
- External smoke checks fail closed and never substitute mocks for sponsor evidence.

## Qodo code-quality requirements

The current official hackathon rules are more specific than the original prompt:

1. Every substantive change must go through a GitHub pull request.
2. Qodo Agentic Review must review the PR before merge.
3. When automatic review does not run, invoke `/agentic_review` on the PR.
4. Every valid High finding must be fixed; disputed findings require a written rationale.
5. Re-run Qodo after corrective changes.
6. A human performs the merge.
7. The README must contain a `Qodo Code Review Evidence` section linking a representative merged PR, explaining findings and changes or dismissals, and linking follow-up review evidence.

### Current status

Qodo has not yet produced a genuine review for this repository. `docs/qodo-review-log.md` remains intentionally empty of findings until the GitHub app is installed and a review is observed.

## Current TrueForge interface facts

Verified against the live TrueForge repository and documentation:

- Runtime package: `@truefoundry/trueforge`.
- TypeScript SDK: `@truefoundry/trueforge-sdk`; repository package version observed: `0.1.3`.
- Required Node version: `>=22.14.0`.
- Local quickstart: `npx @truefoundry/trueforge@latest`.
- Agent specs use snake_case fields such as `mcp_servers`, `require_approval_for_tools`, and `dynamic_sub_agents`.
- Human tool pauses emit `tool.approval_required`; resume input uses `user.tool_approval`.
- Durable reconnect uses session ID, turn ID, sequence number, `getTurn`, `subscribeToTurn`, and `listTurnEvents`.
- Skills are git-backed `SKILL.md` packs and require sandboxing.
- Daytona is the currently documented sandbox provider.
- Subagents are one level deep, run in parallel, share tools and the same sandbox, and cannot ask the user questions directly.
- Context compaction and large-tool-response offloading are available and enabled by default in the documented agent spec.

### Implementation impact

Because TrueForge subagents share a sandbox, EvidenceForge explicitly prohibits mutation during diagnostic fan-out. Reproduction and patching are serialized after aggregation.

## MCP security facts

The current MCP specification treats tool annotations as useful hints rather than a trusted authorization source. Sensitive tool invocation should retain a human in the loop and show the intended tool inputs.

### Implementation impact

EvidenceForge classifies risk using its own trusted registry. MCP annotations are recorded but cannot downgrade `UNKNOWN`, write, destructive, or privileged actions.

## Prize categories observed

- Best Use of TrueForge
- Best Code Quality / Qodo
- Best UI
- Best Blog
- Social/radio-traffic recognition
- Interview opportunities for leading projects

EvidenceForge targets the first three through one coherent vertical slice rather than separate gimmicks.

## Submission materials observed

- Public source repository
- Reproducible setup and README
- Short demo video
- Short project write-up
- Qodo evidence section for the code-quality track
- Blog link when entering the blog category

## Discrepancies from the original build prompt

| Topic | Original prompt | Current official source | Decision |
|---|---|---|---|
| Qodo process | Use throughout development and maintain a review log | Every substantive change must use a Qodo-reviewed PR; High findings need action and README evidence | Official process is enforced |
| Deadline | Verify exact deadline and timezone | August 30 at 20:00 Europe/London | Use 21:00 Europe/Rome and freeze earlier |
| SDK/package | Do not guess | SDK package observed at `0.1.3`; Node `>=22.14` | Pin SDK and Node floor |
| Sandbox provider | Expected Daytona unless changed | Daytona currently documented | Use Daytona; keep provider behind TrueForge |
| Subagents | Parallel diagnostics | Shared sandbox, no nesting, no direct user questions | Enforce read-only fan-out and one level |
| Tool annotations | Do not trust exclusively | MCP specification also treats annotations as non-authoritative hints | Keep EvidenceForge risk overlay |

## External prerequisites not available in this execution environment

- TrueForge server and configured model credentials
- GitHub MCP credentials inside TrueForge
- Daytona credentials inside TrueForge
- Qodo GitHub app installation/permissions

The repository implements and tests all independent work. These items remain blocked until a human supplies the corresponding external connection; no sponsor result is fabricated.
