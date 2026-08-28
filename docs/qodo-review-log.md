# Qodo review log

Record only genuine Qodo findings and observed follow-up evidence.

## Canonical review

- PR: https://github.com/cmdr-chara/evidenceforge/pull/2
- Aggregate Agentic Review: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- Finalization code-candidate request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5454326987
- The final post-documentation exact-SHA request and result are recorded in the PR body because this file cannot contain the SHA of its own commit.

## Current disposition

The finalization code-candidate aggregate reports one remaining bug: **Read-only boundary is unenforced**. It is a valid High finding but is blocked by the public TrueForge SDK `0.1.3` surface. The SDK enables dynamic subagents but exposes no per-dynamic-subagent pre-execution tool allowlist, interceptor, or separate capability set.

EvidenceForge does not label prompt instructions or post-event rejection as equivalent to prevention. The supervisor GitHub MCP surface is restricted and preloaded, specialist roles and budgets are enforced, mutation is serialized, and violations fail closed; the unavailable pre-execution specialist boundary remains explicit.

## Finalization finding

| Severity | Finding | Disposition | Evidence |
|---|---|---|---|
| Medium | Serialization bypasses prompt cap | RESOLVED | task validation now measures the actual JSON-serialized objective and constraint array; a control-character expansion regression rejects text whose raw length is below the cap but serialized length exceeds it |
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

1. Trigger `/agentic_review` after the final documentation commit and exact-head CI.
2. Inspect the aggregate against that exact SHA.
3. Fix any new implementable Critical/High finding.
4. Keep the SDK-blocked High visible.
5. Keep PR #2 unmerged until a human decides to merge.
