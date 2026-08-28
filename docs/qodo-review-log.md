# Qodo review log

Record only genuine Qodo findings and observed follow-up evidence.

## Canonical review

- PR: https://github.com/cmdr-chara/evidenceforge/pull/2
- Aggregate Agentic Review: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- Exact executable-code-head request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5454755804
- The final post-documentation exact-SHA request and result are recorded in the PR body because this file cannot contain the SHA of its own commit.

## Current disposition

The prior exact code-head aggregate marks **Root cause is fabricated** resolved and reports a newer implementable High, **Unresolved references become evidence**. The current candidate addresses that newer finding: exact incident context plus exact reproduction no longer produces a synthetic hypothesis or PASS, and a causal claim becomes a non-authoritative `OPEN` observation only after every cited string resolves to an earlier successful tool result from the same named specialist thread. Model-authored locations, unresolved strings, failed outputs, transport keys, and cross-thread results are not promoted to artifact references. Exact-SHA Qodo confirmation remains external.

The standing SDK-boundary High is **Read-only boundary is unenforced**. It is valid but blocked by the public TrueForge SDK `0.1.3` surface. The SDK enables dynamic subagents but exposes no per-dynamic-subagent pre-execution tool allowlist, interceptor, or separate capability set.

EvidenceForge does not label prompt instructions or post-event rejection as equivalent to prevention. The supervisor GitHub MCP surface is restricted and preloaded, specialist roles and budgets are enforced, mutation is serialized, and violations fail closed; the unavailable pre-execution specialist boundary remains explicit.

## Finalization findings

| Severity | Finding | Disposition | Evidence |
|---|---|---|---|
| High | Root cause is fabricated | RESOLVED | context + reproduction alone remains PENDING; structured causal observation + exact evidence is required for application PASS |
| High | Unresolved references become evidence | FIXED — PENDING EXACT-SHA QODO | cited strings resolve to earlier successful same-thread tool events; missing, failed, transport-key, and cross-thread regressions |
| Medium | Serialization bypasses prompt cap | RESOLVED | task validation measures actual JSON-serialized objective/constraints; hostile control-character regression |
| Medium | Fixture reset command omitted | RESOLVED IN THIS COMMIT | demo preparation invokes `pnpm demo:reset` before fixture validation |
| Medium | Unverified head marked passing | RESOLVED IN THIS COMMIT | executable candidate PASS and self-referential final-documentation-head CI are separate gates |
| High | Read-only boundary is unenforced | BLOCKED — SDK | TrueForge SDK `0.1.3` has no per-dynamic-subagent pre-execution allowlist/interceptor |

## Major resolved reliability findings

Qodo's iterative review also drove and subsequently marked resolved the following classes of defects:

- mutable certificate evidence and stale certificate completion;
- stale approval surviving repatch;
- approval decision races;
- wrong-target PR reconciliation;
- completed-turn cursor stalls;
- checkpoint filename collisions and shared tempfiles;
- cross-task SSE leakage;
- streamed tool calls lost on restart;
- failed tools rendered as success;
- missing restart activity;
- response-level repository/revision/path binding;
- callbacks released after stream timeout;
- initial-turn cursor loss;
- unbounded generation drain;
- approved effect left `EFFECT_STARTED` after failure;
- checkpoint admission before journal append;
- hidden terminal checkpoint failure;
- cancellation retry suppression.

Each implementable behavior change is covered by deterministic regression tests. Historical comment detail remains in the aggregate thread and Git history; this file intentionally records current disposition rather than duplicating every superseded SHA.

## Required release handling

1. Trigger `/agentic_review` after this documentation commit and exact-head CI.
2. Inspect the aggregate against that exact SHA.
3. Fix any new implementable Critical/High finding.
4. Keep the SDK-blocked High visible.
5. Record the exact final request/result in PR #2.
6. Keep PR #2 unmerged until a human decides to merge.
