# Qodo review log

Record only genuine Qodo findings and follow-up evidence.

## Observed review

- PR: https://github.com/cmdr-chara/evidenceforge/pull/2
- Aggregate Agentic Review: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- Earlier follow-up request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5428521720
- Latest reviewed implementation SHA: `c57c5e424054af04c999bd2c144e09b8d54d0622`
- Final exact-SHA request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5440874929
- Latest Qodo aggregate: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- Latest exact-SHA update: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5443260617
- GitHub Actions evidence: runs `33101668750` and `33101672505`, all required steps green including 202/202 tests.

Qodo previously marked **Old patch evidence reused** and **Stale certificate completes state** resolved after the earlier P0.1 batch. Additional earlier findings such as specialist budgets, missing explicit specialist terminal status, blocked-stream mutation, and sequential fan-out were also resolved/outdated in Qodo's thread state before this reconstruction.

## Current High / Medium finding disposition

Qodo's aggregate review was observed for exact implementation SHA `c57c5e4…`. All implementable runtime transaction findings are resolved. The read-only boundary remains explicitly SDK-blocked.

| Severity | Finding | Disposition | Evidence in reconstructed batch |
|---|---|---|---|
| High | Certificate evidence remains mutable | RESOLVED by Qodo | deep-freeze + canonical payload digest + `isIssuedCompletionCertificate` revalidation; nested-mutation test |
| High | Old approval survives repatch | RESOLVED by Qodo | repatch removes old external action, external approval, and operation; regression test |
| Medium | Repatch discards incident evidence | RESOLVED by Qodo | explicit INCIDENT/PATCH/EXTERNAL evidence scopes; incident/root-cause/reproduction preserved on repatch |
| High | Approval decision race | RESOLVED by Qodo | per-task serialized decision flow; concurrent-decision test proves one submission path |
| High | Completed resume cursor stalls | RESOLVED by Qodo | completed replay skips persisted sequence numbers and advances to maximum observed cursor; regression test |
| High | Reconciliation accepts wrong PR | RESOLVED by Qodo | exact repository/base/head/head-SHA/operation/idempotency identity validation; same-SHA/different-target test |
| Medium | Checkpoint task IDs collide | RESOLVED by Qodo | SHA-256 task-keyed filenames + embedded task-ID validation + `a/b` vs `a_b` test |
| Medium | Session saves share tempfile | RESOLVED by Qodo | UUID tempfiles + per-task write chains + concurrent-save test |
| Medium | SSE sessions cross-talk | RESOLVED by Qodo | server subscriptions are task-scoped; reconnect reloads task snapshot; browser task filtering added |
| Medium | Recovery metric counts escalation | RESOLVED by Qodo | common recovery-success definition requires terminal `COMPLETED`; SAFE-but-ESCALATED regression test |
| High | Streamed calls lost on restart | RESOLVED by Qodo | all streamed deltas persist; projector rehydrates event index; restart-before-tool-response integration test |
| Medium | Failed tools shown successful | RESOLVED by Qodo | malformed/error/nonzero tool responses map to ERROR activity; tests cover malformed + nonzero exit |
| Medium | Initial activity disappears after restart | RESOLVED by Qodo | `Incident accepted` reconstructed deterministically from persisted task data; restart snapshot test |
| High | Generation drain can hang | RESOLVED by Qodo | bounded generation drain plus bounded terminal persistence/cancellation; hanging journal/checkpoint/observer regressions |
| High | Approval effect stays started | RESOLVED by Qodo | drain and final-persistence failures mark `EFFECT_UNCERTAIN` before terminal persistence; two regressions |
| High | Checkpoint bypasses event journal | RESOLVED by Qodo | validate on isolated evidence, append journal first, then admit/project/checkpoint; journal-failure regression |
| High | Terminal checkpoint failure hidden | RESOLVED by Qodo | stable `TrueForgeTerminalPersistenceError` prevents false durable-BLOCKED return; regression loads the still-ACTIVE checkpoint |
| High | Cancellation timeout suppresses retries | RESOLVED by Qodo | in-flight/completed cancellation states separated; failed attempts clear for bounded retry while concurrent calls deduplicate |
| High | Read-only boundary is unenforced | **BLOCKED — TrueForge SDK 0.1.3 limitation** | inspected SDK exposes dynamic-subagent enablement but no per-subagent pre-execution tool allowlist/interceptor |

## P0.4 blocked rationale

Qodo is correct that prompt text and post-result checks do not enforce a read-only specialist capability boundary before a mutating tool executes. TrueForge SDK `0.1.3` was inspected directly. The relevant public types expose `dynamicSubAgents.enabled` and dynamic-agent metadata, but no API for a per-dynamic-subagent tool allowlist, pre-execution hook, or separate sandbox/tool set.

EvidenceForge therefore does **not** label this finding fixed. The minimum safe architecture is to keep TrueForge as the runtime and add either:

1. a future TrueForge-supported per-subagent pre-execution tool policy; or
2. a narrow read-only proxy/tool surface supplied to specialists while mutation tools remain available only to the serialized parent flow.

No second orchestration framework is introduced and no post-execution detector is represented as equivalent to prevention.

## Required follow-up

Qodo's exact review of `d9a79c0069c6dac0c71dee38d8312d36c680ec48` added two implementable Highs: **File results lack revision binding** and **Timed-out callbacks persist late**. The subsequent candidate binds GitHub file artifacts using response-level repository/commit identity and introduces a stream-generation fence that suppresses callbacks released after timeout. Both include regressions and remain pending exact-head Qodo confirmation until published.

Qodo's next exact review of `89a8d64603f135963804ec164e4d66c74fb236d9` marked both Highs resolved and added **Initial turns lose restart cursor** and **File path binding is missing**. The subsequent candidate serializes durable event commits during the active stream, preserves initial turn/cursor/evidence for resume, drains an accepted in-flight commit before terminal fail-closed persistence, and requires exact normalized request-path identity for file/resource/directory evidence. These remediations include crash/resume, timeout, traversal, mismatched-path, and unrelated-child regressions and await exact-head Qodo confirmation.

Qodo's exact review of `29290cbf6b9511eaa7860d581c243fbdbfb19231` marked both cursor/path findings resolved and added **Generation drain can hang**, **Approval effect stays started**, and **Checkpoint bypasses event journal**. The `be60a91…` candidate provides bounded fail-closed draining, uncertainty before terminal persistence for approved effects, and journal-first event admission; Qodo marks all three resolved.

1. Preserve the exact-SHA Qodo links in the submission evidence.
2. Request and inspect Qodo against the subsequent exact SHA.
3. Keep the SDK-blocked High visible; do not relabel post-result detection as prevention.
4. Keep PR #2 unmerged until the live/manual gates pass and a human decides to merge.
