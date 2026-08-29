# Qodo review log

Record only genuine Qodo findings and observed follow-up evidence.

## Canonical review

- PR: https://github.com/cmdr-chara/evidenceforge/pull/2
- PR state: merged into `determination` at `819c2815b5bd8cfdf35847ed76a58a457168e74c`
- Aggregate Agentic Review: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- Latest exact executable-code-head request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5455477708
- The final post-documentation exact-SHA request and result are recorded on the follow-up PR because this file cannot contain the SHA of its own commit.

## Current disposition

The aggregate later reported **Nonzero results accepted** against the merged implementation: a nested result with a non-zero `exitCode` could still ground causal evidence. The submission-readiness follow-up rejects non-zero numeric `exitCode` and `exit_code` values at any bounded inspected level and adds deterministic regressions for both spellings. Exact-SHA Qodo confirmation remains a publication gate.

Earlier exact-head reviews marked the fabricated-root-cause, unresolved-reference, nested-failure, and prefix-correlation fixes resolved. Exact incident context plus exact reproduction no longer produces a synthetic hypothesis or PASS. Model-authored locations, unresolved strings, failed outputs, transport keys, cross-thread results, ambiguous prefixes, and non-zero command outputs are not admissible artifact references.

The standing SDK-boundary High is **Read-only boundary is unenforced**. It is valid but blocked by the public TrueForge SDK `0.1.3` surface. The SDK enables dynamic subagents but exposes no per-dynamic-subagent pre-execution tool allowlist, interceptor, or separate capability set.

EvidenceForge does not label prompt instructions or post-event rejection as equivalent to prevention. The supervisor GitHub MCP surface is restricted and preloaded, specialist roles and budgets are enforced, mutation is serialized, and violations fail closed; the unavailable pre-execution specialist boundary remains explicit.

## Finalization findings

| Severity | Finding | Disposition | Evidence |
|---|---|---|---|
| High | Root cause is fabricated | RESOLVED | context + reproduction alone remains PENDING; structured causal observation + exact evidence is required for application PASS |
| High | Unresolved references become evidence | RESOLVED | Qodo's exact-SHA aggregate for `5f7fc10c2327b56dea18645f15035520e48f40ee` marks the finding resolved after same-thread successful-tool-result grounding and its missing, failed, transport-key, and cross-thread regressions |
| High | Failed nested results accepted | RESOLVED | Qodo's exact-SHA aggregate for `917de0ab2edab1f2b49c7a4ea8f1707737402286` marks the bounded recursive rejection and regression resolved |
| High | Reference prefixes miscorrelate evidence | RESOLVED | Qodo's exact-SHA aggregate for `917de0ab2edab1f2b49c7a4ea8f1707737402286` marks lexical-boundary matching and its prefix regression resolved |
| High | Nonzero results accepted | FIXED — AWAITING EXACT-SHA QODO | bounded recursive failure detection now rejects numeric non-zero `exitCode` and `exit_code`; both spellings have integration regressions |
| Medium | Root-cause steps are reversed | RESOLVED | Qodo's exact-SHA aggregate for `8d8ee23b14bb91bd40fc8d369d6894be30be4757` no longer reports the finding after reproduction was ordered before root-cause promotion |
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

The submission-readiness PR followed the required sequence: exact-head CI, `/agentic_review`, aggregate inspection, disposition of findings and human squash merge. Future substantive changes must repeat the same process. The SDK-blocked High remains visible until TrueForge exposes a pre-execution per-subagent enforcement surface.
