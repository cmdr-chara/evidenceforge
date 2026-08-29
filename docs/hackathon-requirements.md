# Agent Harness Hackathon requirements

**Last synchronized:** 2026-08-29

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
- The substantive merged head passed exact-head GitHub Actions; the consolidated follow-up candidate contains 250 tests.
- The deterministic evaluation measured 0% false success for EvidenceForge versus 57.14% for the unenforced baseline.

### Live sponsor evidence

The strongest credentialed run reached all ten application gates and demonstrated:

- exact GitHub incident context;
- exactly three TrueForge specialists;
- Daytona bootstrap and failure reproduction;
- supported root cause;
- patch capture;
- deterministic regression/tests/typecheck/lint/diff verification;
- independent patch review;
- a human approval pause for the exact external action;
- an observed GitHub MCP PR write and authoritative PR reconciliation;
- an application-issued CompletionGate certificate.

The observed external write is [PR #9](https://github.com/cmdr-chara/evidenceforge/pull/9), which was not merged and is retained as public evidence. Earlier invalid-target and specialist-budget attempts remained blocked. The reported 10/10 is the product's configured success contract, not a hackathon score.

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

The candidate fixes the fabricated-root-cause, unresolved-reference, nested-failure, prefix-correlation, and non-zero-result paths. Context plus reproduction alone leaves the criterion pending; a specialist causal claim becomes a non-authoritative observation only after each reference resolves to an earlier successful same-thread tool result, and the application promotes it only after exact-evidence correlation. Exact-SHA confirmation of the follow-up remains external.

One High remains **BLOCKED by TrueForge SDK 0.1.3**: per-dynamic-subagent read-only pre-execution enforcement. The SDK exposes no per-dynamic-subagent interceptor/allowlist, so post-event rejection is not represented as prevention.

The same review identified two implementable Medium documentation findings. This synchronization adds the required `pnpm demo:reset` command and represents the self-referential final-documentation-head CI check as an external PR gate rather than an in-repository PASS.

The post-documentation exact-SHA review request and status are recorded in submission-readiness PR #4.

## UI evidence boundary

The 320, 375, 768, 1024, and 1440px layouts were browser-observed without page-level horizontal overflow. Changes after that observation do not alter layout geometry. The final accessibility pass raises muted small-text contrast and adds a deterministic contrast test.

Exact 200% browser zoom was manually observed without horizontal overflow or sibling overlap. It is recorded as direct observation, not inferred from an equivalent viewport width.

## Remaining external/human actions

- observe and record exact-head CI and Qodo for the submission-readiness PR;
- preserve the recorded credentialed live approval/write/reconciliation/certificate evidence;
- preserve the exact 200% browser zoom review evidence;
- keep the public demo video available;
- inspect the final exact-SHA Qodo aggregate;
- human merge of the submission-readiness PR into `determination`;
- complete the official submission before the observed deadline.

No Qodo closure, merge, video, or submission is represented as complete without observed evidence.
