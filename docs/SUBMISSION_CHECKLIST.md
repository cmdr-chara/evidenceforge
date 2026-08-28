# Submission checklist

**Last synchronized:** 2026-08-28

## Sponsor usage

- [x] TrueForge SDK `0.1.3` integrated as the primary runtime boundary.
- [x] GitHub MCP configured in the agent spec.
- [x] Daytona sandbox enabled in the agent spec.
- [x] Exactly three dynamic diagnostic specialists defined.
- [x] Four TrueForge skills authored.
- [x] Durable session/turn/sequence reconnect implemented.
- [x] Restart-before-tool-response correlation implemented and tested.
- [x] Human approval resume protocol implemented.
- [ ] Per-specialist pre-execution read-only tool enforcement — **BLOCKED by TrueForge SDK 0.1.3 API surface**.
- [x] Real TrueForge session and model turn observed — session `01m11zp6dfp08dq520eqsp9cdx`, turn `01m11zp6dyt1xq08qwdkzdns1h.local`.
- [x] Real GitHub MCP incident read observed — official `get_commit` returned exact SHA `7555f0f0…`.
- [ ] Real Daytona reproduction observed.
- [x] Daytona provider connectivity and a successful command execution observed separately; this is not the failing-revision reproduction.
- [x] Real skill materialization/use observed in a credentialed TrueForge session.
- [x] Exactly three specialists created and completed in live task `task-2a0444d3…`.
- [ ] Completed live sponsor vertical slice — latest attempt is **BLOCKED by model-provider HTTP 402 insufficient balance**.
- [ ] Real approval pause/resume observed.

## Domain/control plane

- [x] Success contract before completion.
- [x] Evidence provenance bound to task/repository/revision/current subject.
- [x] Failure reproduction criterion.
- [x] Deterministic verifier engine.
- [x] Model prose cannot fake PASS or COMPLETED.
- [x] CompletionGate-only certificate path.
- [x] Deep-immutable certificate with canonical payload digest.
- [x] Certificate binds task, repo, revision, patch, state version/digest, contract and subject digest.
- [x] Repatch preserves incident evidence and invalidates patch/external evidence.
- [x] Repatch invalidates stale external approvals/actions/operations.
- [x] Per-task approval decisions serialized; concurrent path has one submission.
- [x] Approval provenance bound to current patch and exact operation.
- [x] Exact PR reconciliation verifies repo/base/head/head SHA/operation/idempotency.
- [x] Official GitHub MCP adapter keeps operation metadata application-owned and requires create receipt → authoritative PR read.
- [x] Same SHA on a different target PR is rejected.
- [x] Completed resume advances the maximum cursor and skips replayed history.
- [x] Terminal cutoff prevents late actionable mutation/persistence.
- [x] Collision-safe persistence and unique tempfiles.
- [x] Legacy persistence read fallback retained without migration.
- [x] Recovery success requires terminal `COMPLETED` for baseline and EvidenceForge.

## Live activity / UI

- [x] Task-scoped server SSE subscriptions.
- [x] Snapshot reload on reconnect.
- [x] Browser defense-in-depth task filtering.
- [x] Malformed/non-zero/failed tool responses display ERROR rather than SUCCESS.
- [x] Initial `Incident accepted` activity survives restart via deterministic reconstruction.
- [x] Terminal activity distinguishes BLOCKED/FAILED/ESCALATED from SUCCESS.
- [x] Skip link, visible focus, accessible log/live region.
- [x] >=44px primary interactive targets.
- [x] Long SHA/revision/trace values expose full accessible/title values.
- [x] Responsive narrow-layout and reduced-motion rules.
- [x] Browser-observe 320px — no page-level horizontal overflow; phase rail remains intentionally scrollable.
- [x] Browser-observe 375px — no page-level horizontal overflow; phase rail remains intentionally scrollable.
- [x] Browser-observe 768px — clean section boundaries and no page-level horizontal overflow.
- [x] Browser-observe 1024px — no page-level horizontal overflow.
- [x] Browser-observe 1440px — no page-level horizontal overflow.
- [ ] Browser-observe 200% zoom.

## Quality

Latest technical implementation SHA: `aed84feb7205d7b66a13804fc2fb8f4184f2324f`,
GitHub Actions runs `33155806482` and `33155815342`, **204/204 tests**.

- [x] `pnpm install --frozen-lockfile`.
- [x] `pnpm format:check`.
- [x] `pnpm lint`.
- [x] `pnpm typecheck`.
- [x] `pnpm test` — **204/204 passed** on exact-SHA push and PR CI.
- [x] `pnpm eval:smoke`.
- [x] `pnpm demo:fixture`.
- [x] `pnpm build`.
- [x] `pnpm doctor`.
- [x] `git diff --check`.
- [x] GitHub Actions CI exists and a current reconstructed implementation SHA was observed green.
- [x] Final documentation-head CI observed green.

## Qodo

- [x] PR #2 exists and remains open/unmerged.
- [x] Genuine Qodo Agentic Review observed: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- [x] Earlier follow-up request observed: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5428521720
- [x] Every currently implementable open High/Medium finding has repository-side code + test remediation.
- [x] Read-only pre-execution finding documented as SDK-blocked rather than falsely resolved.
- [x] Request `/agentic_review` on the final exact SHA: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5440874929
- [x] Inspect latest published-head Qodo response: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5442750603.
- [x] Inspect fail-closed runtime Qodo response: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5443087230; all three latest implementable findings resolved.
- [x] Inspect exact `c57c5e4…` aggregate after terminal-durability/cancellation fixes: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502; only the SDK-blocked High remains.
- [x] Preserve the exact-SHA Qodo update: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5443260617.
- [ ] Human merge after required review/live gates.

## Demo vertical slice required before submission

1. Start from a real failed GitHub Actions run and record run URL/SHA.
2. Start a credentialed EvidenceForge live session through TrueForge.
3. Show GitHub MCP retrieving authoritative incident context.
4. Show three specialist diagnostics; do not claim pre-execution read-only isolation beyond SDK capabilities.
5. Show Daytona checking out the exact failing revision and reproducing the stable failure.
6. Show serialized patch creation and patch digest.
7. Show deterministic verification and independent review.
8. Show the exact approval payload and real `tool.approval_required` pause.
9. Human approves the external PR write.
10. Show the created PR and exact reconciliation identity.
11. Show CompletionGate issuing the only accepted completion certificate.
12. Refresh/reconnect the browser and show the task-scoped durable snapshot.
13. Capture approximately three minutes of the real path; clearly label any fixture-only fallback footage.

## Documentation

- [x] README synchronized.
- [x] Qodo review log contains real findings/status, not a placeholder.
- [x] Hackathon requirements synchronized.
- [x] Gate ledger synchronized.
- [x] Submission checklist synchronized.
- [x] Build journal synchronized with reconstruction evidence.
- [x] Field report draft synchronized with Qodo/SDK limitations.
- [ ] Add final live-run URLs and demo video URL after they genuinely exist.
- [x] Add final Qodo follow-up result after it genuinely exists.

## Repository hygiene

- [x] Default branch remains `determination`.
- [x] Substantive work stays on `feat/foundation-control-plane`.
- [x] `.evidenceforge/` ignored and preserved.
- [x] No force push used in this reconstruction.
- [x] No merge performed.
- [x] Jury merge strategy documented: preserve PR history, then human `Squash and merge` into one professional `determination` commit.
- [ ] Final secret/diff review before human merge.

## Submission

- [x] Public repository exists.
- [ ] Credentialed live sponsor vertical slice complete.
- [ ] Exact viewport/200% visual check complete.
- [x] Exact-head Qodo re-review after the latest three implementable runtime remediations; the SDK-blocked High remains disclosed.
- [ ] Human merge complete.
- [ ] Demo video URL added.
- [ ] Blog URL added if entering blog category.
- [x] AI-assistance disclosure retained.
- [ ] Official submission completed before the observed deadline.
