# ADR 0007: Durable evidence-gated harness hardening

## Status

Accepted — 2026-08-25

## Context

TrueForge already owns the generic agent runtime: model and tool execution, MCP, Daytona sandboxing, sessions, subagents, approvals, streaming, and context management. Replacing it with another coding-agent harness would duplicate responsibilities and violate the product boundary. EvidenceForge still needs stronger application-level controls against uncertain effects, blind retries, no-progress loops, context loss, approval substitution, ambiguous mutation, and natural termination without proof.

## Decision

Keep TrueForge as the sole runtime and add the following EvidenceForge-owned mechanisms:

- per-operation `SAFE | RECONCILE_FIRST | NEVER` replay policy;
- durable `INTENT_DURABLE → EFFECT_STARTED → SETTLED`, with explicit `EFFECT_UNCERTAIN` recovery;
- round-level deterministic success-contract evaluation and supervisor `StopGuard`;
- semantic tool-attempt fingerprints with reconsider → replan → escalate;
- exact base-verified, non-overlapping, serialized structured edits with patch digests;
- approval provenance bound to action, arguments, repository/revision, risk, operation, expiry, and one-shot use;
- separate authoritative evidence and bounded model-facing projections;
- persisted operation program counters, round evaluations, and loop telemetry.

No exactly-once guarantee is claimed for external systems that cannot provide it.

## Reference ideas and attribution

These mechanisms are adaptations of public ideas, not inventions unique to EvidenceForge:

- [Pi compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md): append compaction entries while preserving cumulative file-operation history. EvidenceForge adopts the separation between lossy model context and durable facts.
- [ZCode Goal Mode](https://zcode.z.ai/en/docs/goal): verify after every round and continue when objective evidence is incomplete. EvidenceForge makes the verdict deterministic against a success contract.
- [Claude Code hooks](https://code.claude.com/docs/en/hooks): `Stop` and `TaskCompleted` hooks can prevent termination, with bounded protection against endless stop blocking. EvidenceForge adopts a supervisor stop guard and explicit loop budgets.
- [OpenCode permissions](https://opencode.ai/docs/permissions/): `doom_loop` detects the same tool call repeated three times. EvidenceForge extends the fingerprint with normalized arguments, revision/state, and result signature and uses staged responses.
- [Codex sandboxing and approvals](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/sandboxing.rs): separate sandbox enforcement, approval requirements, scoped approval keys, and telemetry. EvidenceForge binds approval to the exact domain operation and external revision.
- [Kimi Code CLI loop/session controls](https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/reference/kimi-command.md): bounded step/retry/iteration controls and persistent session artifacts. EvidenceForge persists domain program counters and recovery decisions.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): composable plugin/runtime boundaries. EvidenceForge retains a separate control layer rather than importing a second runtime.

## Rejected alternatives

- Replacing TrueForge with Pi, ZCode, Claude Code, DeepSeek Harness, OpenCode, Codex, or Kimi Code: duplicates runtime ownership and confounds sponsor evidence.
- Treating model or reviewer prose as a completion verifier: circular and vulnerable to false success.
- Retrying every timeout under one numeric budget: can duplicate effects and repeat impossible work.
- Claiming exactly-once external writes from local idempotency keys alone: not supportable without authoritative external guarantees.
- Keeping only compacted summaries: would make deterministic verification depend on lossy model context.
- Removing shell access in favor of structured edits: prevents practical repository work; narrow edits are preferred where applicable, not universal.
- Automatically applying destructive or ambiguous mutations: unsafe and difficult to reconcile after crashes.

## Consequences

- Session state and tests are larger, and successful completion has a small deterministic control-plane cost.
- More unsafe or incomplete cases become `BLOCKED`/`ESCALATED` and may require human intervention.
- Crash recovery can state what was intended, whether the effect is uncertain, whether replay is legal, what evidence exists, and the next legal action.
- Live sponsor/runtime validation remains a separate external gate.
