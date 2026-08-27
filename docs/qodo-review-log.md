# Qodo review log

Record only genuine Qodo findings and follow-up evidence.

## Observed review

- PR: https://github.com/cmdr-chara/evidenceforge/pull/2
- Aggregate Agentic Review: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- Earlier follow-up request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5428521720
- Final reviewed SHA: `7555f0f01f1af1f198d665333098619d05408230`
- Final exact-SHA request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5440874929
- Qodo exact-SHA update: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5440921739
- GitHub Actions evidence: runs `33084240703` and `33084235854`, all required steps green including 159/159 tests.

Qodo previously marked **Old patch evidence reused** and **Stale certificate completes state** resolved after the earlier P0.1 batch. Additional earlier findings such as specialist budgets, missing explicit specialist terminal status, blocked-stream mutation, and sequential fan-out were also resolved/outdated in Qodo's thread state before this reconstruction.

## Current High / Medium finding disposition

Qodo's aggregate review was observed after its exact-SHA update. It reports `Bugs (1)`: every implementable finding below is resolved; the remaining read-only boundary is explicitly SDK-blocked.

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
| High | Read-only boundary is unenforced | **BLOCKED — TrueForge SDK 0.1.3 limitation** | inspected SDK exposes dynamic-subagent enablement but no per-subagent pre-execution tool allowlist/interceptor |

## P0.4 blocked rationale

Qodo is correct that prompt text and post-result checks do not enforce a read-only specialist capability boundary before a mutating tool executes. TrueForge SDK `0.1.3` was inspected directly. The relevant public types expose `dynamicSubAgents.enabled` and dynamic-agent metadata, but no API for a per-dynamic-subagent tool allowlist, pre-execution hook, or separate sandbox/tool set.

EvidenceForge therefore does **not** label this finding fixed. The minimum safe architecture is to keep TrueForge as the runtime and add either:

1. a future TrueForge-supported per-subagent pre-execution tool policy; or
2. a narrow read-only proxy/tool surface supplied to specialists while mutation tools remain available only to the serialized parent flow.

No second orchestration framework is introduced and no post-execution detector is represented as equivalent to prevention.

## Required follow-up

1. Preserve the exact-SHA Qodo links above in the submission evidence.
2. Keep the SDK-blocked High visible; do not relabel post-result detection as prevention.
3. Keep PR #2 unmerged until the live/manual gates pass and a human decides to merge.
