# Agent Harness Hackathon requirements

**Last synchronized:** 2026-08-28

This file records the requirements that materially affect EvidenceForge. Official event pages remain authoritative.

## Official sources

- Hackathon: https://www.wemakedevs.org/hackathons/trueforge
- Kick-off and rules: https://www.wemakedevs.org/blogs/agent-harness-hackathon-kick-off
- TrueForge: https://github.com/truefoundry/trueforge
- TrueForge documentation: https://trueforge.dev
- Qodo documentation: https://docs.qodo.ai/
- Daytona documentation: https://www.daytona.io/docs/

## Event window

- Event window: August 24–30, 2026.
- Observed closing time: August 30, 2026 at 20:00 Europe/London, equivalent to 21:00 Europe/Rome.
- Release policy: freeze feature scope before the deadline and preserve time for a truthful demo, human review, merge, and submission.

## Mandatory submission work

1. TrueForge must be the primary orchestration runtime and must visibly perform real work.
2. The repository must be public and reproducible.
3. The submission needs a concise write-up and a short demo video.
4. Sponsor usage must be demonstrated, not asserted.
5. AI coding assistance must be disclosed.
6. Qodo Agentic Review must be used on the substantive pull request before human merge.

## Current implementation status

### Repository and control plane

- TrueForge SDK `0.1.3` is the runtime boundary; no second agent framework is introduced.
- GitHub MCP, Daytona, four skills, approvals, compaction, exactly three dynamic specialists, bounded iterations, and durable session recovery are integrated.
- `CompletionGate` is the only application path to `COMPLETED`.
- Exact PR identity, approval provenance, stale evidence/certificate rejection, repatch invalidation, crash recovery, terminal cutoffs, and collision-safe persistence are implemented and tested.
- Exact-head CI runs the frozen verification matrix and currently contains 220 passing tests.
- The deterministic evaluation measured 0% false success for EvidenceForge versus 57.14% for the unenforced baseline.

### Live sponsor evidence

The strongest credentialed run reached 9/10 gates and demonstrated:

- exact GitHub incident context;
- exactly three TrueForge specialists;
- Daytona bootstrap and failure reproduction;
- supported root cause;
- patch capture;
- deterministic regression/tests/typecheck/lint/diff verification;
- independent patch review.

`external-pr` remains the unverified live gate. One invalid PR target was blocked before write; a later run was blocked when a specialist exceeded its tool budget. No wrong PR, automatic approval, or merge occurred.

The deterministic fixture completes all ten criteria and issues a certificate. It is control-plane evidence, not live sponsor evidence.

## Qodo requirements and status

Required workflow:

1. substantive PR;
2. `/agentic_review` when needed;
3. fix every valid implementable Critical/High finding;
4. rerun Qodo after changes;
5. document genuinely blocked findings;
6. human merge only after review.

Canonical aggregate: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502

The final code-candidate review contains one remaining bug: the per-dynamic-subagent read-only pre-execution boundary. It remains **BLOCKED by TrueForge SDK 0.1.3**, which exposes no per-dynamic-subagent interceptor/allowlist. The serialization/prompt-cap finding was fixed by validating actual JSON-serialized prompt length and adding a control-character expansion regression.

The post-documentation exact-SHA review request and status are recorded in PR #2, avoiding a self-referential repository document.

## UI evidence boundary

The 320, 375, 768, 1024, and 1440px layouts were browser-observed without page-level horizontal overflow. Changes after that observation do not alter layout geometry. The final accessibility pass raises muted small-text contrast and adds a deterministic contrast test.

Exact 200% browser zoom remains a manual check. A width-equivalent reflow must not be represented as exact zoom evidence.

## Remaining external/human actions

- reproduce a stable credentialed live path through `external-pr`, approval, write, reconciliation, and certificate, or present the live result as 9/10 without embellishment;
- perform exact 200% browser zoom review;
- record and publish the demo video;
- inspect the final exact-SHA Qodo aggregate;
- human `Squash and merge` PR #2 into `determination`;
- complete the official submission before the observed deadline.

No live completion, Qodo closure, merge, video, or submission is represented as complete without observed evidence.
