# Qodo review log

Record only genuine Qodo findings and follow-up evidence.

## Observed review

- PR: https://github.com/cmdr-chara/evidenceforge/pull/2
- Aggregate Agentic Review: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- Earlier follow-up request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5428521720
- Verified implementation baseline before this documentation pass: `628d4db9a19e50b142051fe3ae2793b0b9b704ad`
- GitHub Actions evidence for that baseline: run `33083635762`, all required steps green including 159/159 tests.

Qodo previously marked **Old patch evidence reused** and **Stale certificate completes state** resolved after the earlier P0.1 batch. Additional earlier findings such as specialist budgets, missing explicit specialist terminal status, blocked-stream mutation, and sequential fan-out were also resolved/outdated in Qodo's thread state before this reconstruction.

## Current High / Medium finding disposition

The following findings were still open in the last observed Qodo thread set. `FIXED` below means the repository now contains a targeted implementation and deterministic regression test; it does **not** mean Qodo has re-reviewed the final SHA yet.

| Severity | Finding | Disposition | Evidence in reconstructed batch |
|---|---|---|---|
| High | Certificate evidence remains mutable | FIXED, Qodo re-review pending | deep-freeze + canonical payload digest + `isIssuedCompletionCertificate` revalidation; nested-mutation test |
| High | Old approval survives repatch | FIXED, Qodo re-review pending | repatch removes old external action, external approval, and operation; regression test |
| Medium | Repatch discards incident evidence | FIXED, Qodo re-review pending | explicit INCIDENT/PATCH/EXTERNAL evidence scopes; incident/root-cause/reproduction preserved on repatch |
| High | Approval decision race | FIXED, Qodo re-review pending | per-task serialized decision flow; concurrent-decision test proves one submission path |
| High | Completed resume cursor stalls | FIXED, Qodo re-review pending | completed replay skips persisted sequence numbers and advances to maximum observed cursor; regression test |
| High | Reconciliation accepts wrong PR | FIXED, Qodo re-review pending | exact repository/base/head/head-SHA/operation/idempotency identity validation; same-SHA/different-target test |
| Medium | Checkpoint task IDs collide | FIXED, Qodo re-review pending | SHA-256 task-keyed filenames + embedded task-ID validation + `a/b` vs `a_b` test |
| Medium | Session saves share tempfile | FIXED, Qodo re-review pending | UUID tempfiles + per-task write chains + concurrent-save test |
| Medium | SSE sessions cross-talk | FIXED, Qodo re-review pending | server subscriptions are task-scoped; reconnect reloads task snapshot; browser task filtering added |
| Medium | Recovery metric counts escalation | FIXED, Qodo re-review pending | common recovery-success definition requires terminal `COMPLETED`; SAFE-but-ESCALATED regression test |
| High | Streamed calls lost on restart | FIXED, Qodo re-review pending | all streamed deltas persist; projector rehydrates event index; restart-before-tool-response integration test |
| Medium | Failed tools shown successful | FIXED, Qodo re-review pending | malformed/error/nonzero tool responses map to ERROR activity; tests cover malformed + nonzero exit |
| Medium | Initial activity disappears after restart | FIXED, Qodo re-review pending | `Incident accepted` reconstructed deterministically from persisted task data; restart snapshot test |
| High | Read-only boundary is unenforced | **BLOCKED — TrueForge SDK 0.1.3 limitation** | inspected SDK exposes dynamic-subagent enablement but no per-subagent pre-execution tool allowlist/interceptor |

## P0.4 blocked rationale

Qodo is correct that prompt text and post-result checks do not enforce a read-only specialist capability boundary before a mutating tool executes. TrueForge SDK `0.1.3` was inspected directly. The relevant public types expose `dynamicSubAgents.enabled` and dynamic-agent metadata, but no API for a per-dynamic-subagent tool allowlist, pre-execution hook, or separate sandbox/tool set.

EvidenceForge therefore does **not** label this finding fixed. The minimum safe architecture is to keep TrueForge as the runtime and add either:

1. a future TrueForge-supported per-subagent pre-execution tool policy; or
2. a narrow read-only proxy/tool surface supplied to specialists while mutation tools remain available only to the serialized parent flow.

No second orchestration framework is introduced and no post-execution detector is represented as equivalent to prevention.

## Required follow-up

After the final documentation/code SHA is pushed:

1. request `/agentic_review` on PR #2;
2. record the exact follow-up comment URL;
3. wait for and inspect Qodo's response against that exact SHA;
4. mark a finding resolved only when Qodo evidence or a documented blocked/disputed rationale supports it;
5. keep PR #2 unmerged until a human decides to merge.
