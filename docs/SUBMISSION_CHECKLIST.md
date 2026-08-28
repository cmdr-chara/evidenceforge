# Submission checklist

**Last synchronized:** 2026-08-28

## Repository and control plane

- [x] Work remains on `feat/foundation-control-plane`.
- [x] PR #2 targets `determination` and remains open/unmerged.
- [x] No force push, rebase, or direct modification of `determination`.
- [x] TrueForge remains the primary runtime; no second agent framework.
- [x] Application-owned CompletionGate is the only completion path.
- [x] Deeply immutable, canonically digested completion certificate.
- [x] Task/repository/revision/patch/state/success-contract bindings.
- [x] Stale certificate/evidence rejection and repatch invalidation.
- [x] Approval provenance, expiry, one-time consumption, and race serialization.
- [x] Durable operation intent/effect/settlement and uncertainty handling.
- [x] Exact pull-request reconciliation.
- [x] Crash recovery, bounded drain, terminal cutoffs, and collision-safe persistence.
- [x] `.data/` and `.evidenceforge/` ignored and untracked.

## Live orchestration

- [x] Exact incident `get_commit` bound to repository and failing revision.
- [x] Application-owned bootstrap before verification.
- [x] Exactly three named diagnostic specialists in one fan-out.
- [x] Bounded specialist tool budgets; violations block.
- [x] Bounded structured causal-output contract for each specialist.
- [x] Specialist causal claims stored as non-authoritative OPEN observations.
- [x] Root-cause PASS requires exact incident, exact reproduction, and current causal evidence.
- [x] Context plus reproduction alone leaves root cause PENDING.
- [x] Repository execution constrained to Daytona in live workflows.
- [x] Exact failure reproduction and root-cause subject binding.
- [x] Patch capture before post-patch verification.
- [x] Application-owned deterministic verifier manifests.
- [x] Isolated patch-digest-bound independent reviewer.
- [x] Supervisor GitHub MCP restricted/preloaded to `get_commit`, `create_pull_request`, `pull_request_read`.
- [x] Wrong base/head and missing head read block before write.
- [x] PR write pauses for human approval.
- [x] Approval is exact-argument/operation/repository/revision/patch/expiry bound.
- [x] Reconciliation requires authoritative `pull_request_read`.
- [x] BLOCKED tasks cannot resume as ACTIVE.
- [ ] Per-dynamic-subagent pre-execution read-only enforcement — **SDK 0.1.3 blocked**.

## Verification

The exact executable code head contains 226 tests and passed the complete frozen matrix. Because this checklist changes repository state, verification of the commit containing this checklist is deliberately a separate external gate recorded in PR #2.

- [x] `pnpm install --frozen-lockfile` on the executable code head.
- [x] `pnpm format:check` on the executable code head.
- [x] `pnpm lint` on the executable code head.
- [x] `pnpm typecheck` on the executable code head.
- [x] `pnpm test` — 226/226 on the executable code head.
- [x] `pnpm eval:smoke` on the executable code head.
- [x] `pnpm demo:fixture` on the executable code head.
- [x] `pnpm build` on the executable code head.
- [x] `pnpm doctor` on the executable code head.
- [x] `git diff --check` on the executable code head.
- [x] Push and pull-request workflows green on the executable code head.
- [ ] Confirm the same matrix on the commit containing this checklist and record it in PR #2.

## Live evidence

- [x] Credentialed TrueForge/model workflow observed.
- [x] Exact GitHub MCP incident read observed.
- [x] Daytona bootstrap/reproduction observed in the strongest run.
- [x] Exactly three specialists observed.
- [x] Regression/tests/typecheck/lint/diff and independent review observed.
- [x] Strongest credentialed result recorded as 9/10, not completed.
- [x] Invalid PR target blocked before write.
- [x] Specialist budget violation blocked.
- [ ] Human approval → live PR write → authoritative reconciliation observed.
- [ ] Live CompletionGate certificate observed.
- [x] Deterministic 10/10 fixture kept explicitly separate from live evidence.

## UI and accessibility

- [x] Task-scoped SSE and reconnect snapshot.
- [x] Explicit model/tool/application PASS/approval/BLOCKED/certified states.
- [x] Accessible live/log regions, skip link, visible focus, and reduced motion.
- [x] >=44px primary interactive targets.
- [x] Long repository/SHA/task values wrap or expose full accessible labels.
- [x] Bounded readable diff/activity regions.
- [x] 320px browser observation.
- [x] 375px browser observation.
- [x] 768px browser observation.
- [x] 1024px browser observation.
- [x] 1440px browser observation.
- [x] Small muted-text contrast regression fixed and tested.
- [ ] Exact 200% browser zoom observation.

## Qodo

- [x] Genuine Agentic Review aggregate: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- [x] Every implementable Critical/High finding on the executable code head fixed or resolved.
- [x] JSON serialization prompt-cap finding fixed with deterministic regression.
- [x] Fabricated root-cause finding fixed with negative and positive exact-evidence regressions.
- [x] SDK-limited read-only boundary retained as BLOCKED, not falsely resolved.
- [x] Demo reset command added.
- [x] Final-documentation-head verification represented as an external gate, not a premature PASS.
- [ ] Record the post-documentation exact-SHA `/agentic_review` request and result in PR #2.

## Documentation and demo

- [x] README synchronized without self-invalidating current-SHA claims.
- [x] TrueForge setup distinguishes normal frozen CI from historical no-lockfile bootstrap.
- [x] Hackathon requirements synchronized.
- [x] Gate ledger and checklist synchronized.
- [x] Build journal and field report synchronized.
- [x] Qodo review log synchronized.
- [x] Demo script runs `pnpm demo:reset` before fixture validation.
- [x] Demo script separates credentialed 9/10 evidence from deterministic certificate footage.
- [ ] Add public demo video URL.
- [ ] Perform final secret/diff review before human merge.

## Human release and submission

- [ ] Inspect final exact-head CI.
- [ ] Inspect final exact-SHA Qodo aggregate.
- [ ] Perform exact 200% zoom check.
- [ ] Record demo video.
- [ ] Human `Squash and merge` PR #2.
- [ ] Use squash title `feat: add EvidenceForge evidence-gated incident control plane`.
- [ ] Complete official hackathon submission before the observed deadline.
