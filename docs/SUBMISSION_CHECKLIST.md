# Submission checklist

**Last synchronized:** 2026-08-29

## Repository and control plane

- [x] Substantive work was squash-merged through PR #2 into `determination`.
- [x] PR #2 is closed as merged; its Qodo thread and review history remain public.
- [x] Submission finalization is isolated on `codex/submission-readiness` under issue #3.
- [x] No force push or rebase of published history.
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
- [x] Every causal reference resolves to an earlier successful tool result from the same specialist thread.
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

The current executable candidate contains 258 tests. Exact-head CI remains an external publication gate because a repository document cannot contain the result of the commit that contains itself.

- [x] `pnpm install --frozen-lockfile` on the executable code head.
- [x] `pnpm format:check` on the executable code head.
- [x] `pnpm lint` on the executable code head.
- [x] `pnpm typecheck` on the executable code head.
- [x] `pnpm test` — 256/256 on the executable candidate.
- [x] `pnpm eval:smoke` on the executable code head.
- [x] `pnpm demo:fixture` on the executable code head.
- [x] `pnpm build` on the executable code head.
- [x] `pnpm doctor` on the executable code head.
- [x] `git diff --check` on the executable code head.
- [x] Push and pull-request workflows green on the executable code head.
- [x] Exact-head CI passed on `0d370768b4195c4ac9fd763ad140118dfad6a90d`: https://github.com/cmdr-chara/evidenceforge/actions/runs/33196634885

## Live evidence

- [x] Credentialed TrueForge/model workflow observed.
- [x] Exact GitHub MCP incident read observed.
- [x] Daytona bootstrap/reproduction observed in the strongest run.
- [x] Exactly three specialists observed.
- [x] Regression/tests/typecheck/lint/diff and independent review observed.
- [x] Credentialed live workflow reached 10/10 only after human-approved external write and reconciliation.
- [x] Invalid PR target blocked before write.
- [x] Specialist budget violation blocked.
- [x] Human approval → live PR write → authoritative reconciliation observed in PR #9.
- [x] Live CompletionGate certificate observed and recorded in `docs/live-external-write-proof.md`.
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
- [x] Exact 200% browser zoom observed at a 908×706 CSS viewport: no horizontal overflow or sibling overlap; long revision and trace values now reflow without clipping.

## Qodo

- [x] Genuine Agentic Review aggregate: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- [x] Qodo's later **Nonzero results accepted** High fixed with `exitCode` and `exit_code` regressions.
- [x] JSON serialization prompt-cap finding fixed with deterministic regression.
- [x] Fabricated root-cause finding fixed with negative and positive exact-evidence regressions.
- [x] Unresolved diagnostic references rejected with missing, failed-result, transport-key, and cross-thread regressions.
- [x] SDK-limited read-only boundary retained as BLOCKED, not falsely resolved.
- [x] Demo reset command added.
- [x] Final-documentation-head verification represented as an external gate, not a premature PASS.
- [x] Exact-SHA `/agentic_review` request and result recorded on submission-readiness PR #4.
- [x] Qodo reports 0 bugs and 0 rule violations on the follow-up aggregate: https://github.com/cmdr-chara/evidenceforge/pull/4#issuecomment-5455852549
- [x] Explicit SDK-blocked read-only disposition recorded in the PR thread: https://github.com/cmdr-chara/evidenceforge/pull/4#issuecomment-5455815694

## Documentation and demo

- [x] README synchronized without self-invalidating current-SHA claims.
- [x] TrueForge setup distinguishes normal frozen CI from historical no-lockfile bootstrap.
- [x] Hackathon requirements synchronized.
- [x] Gate ledger and checklist synchronized.
- [x] Build journal and field report synchronized.
- [x] Qodo review log synchronized.
- [x] Demo script runs `pnpm demo:reset` before fixture validation.
- [x] Demo script separates the deterministic baseline from credentialed live evidence.
- [x] Public demo video: https://streamable.com/5sbk1k
- [x] GitHub Pages build preserves an explicitly static fixture boundary.
- [ ] Observe the deployed fixture at https://cmdr-chara.github.io/evidenceforge/ after human merge.
- [x] Final secret/diff review completed; high-confidence token matches were confirmed as synthetic `task-*` fixture identifiers.

## Human release and submission

- [x] Inspect CI on the final published documentation/media head in PR #4.
- [x] Inspect Qodo on the final published documentation/media head in PR #4.
- [x] Perform exact 200% zoom check.
- [x] Record and publish demo video.
- [x] Human `Squash and merge` PR #2 completed.
- [x] Human merge of the narrow submission-readiness PR after exact-head CI and Qodo.
- [ ] Complete official hackathon submission before the observed deadline.
