# EvidenceForge build journal

**Finalization snapshot:** 2026-08-28

This journal records the production path and its evidence boundaries. Commit-level history remains available in PR #2.

## 1. Foundation and recovery

The branch was reconstructed and hardened without rewriting published history. The foundation established:

- deterministic task/session state and success contracts;
- application-owned CompletionGate;
- exact task/repository/revision/patch/state bindings;
- deeply immutable, canonically digested certificates;
- admissible evidence scopes and stale-evidence rejection;
- repatch invalidation;
- approval provenance and serialized decisions;
- durable operation intent/effect/settlement;
- exact external-state reconciliation;
- collision-safe persistence and legacy read fallback.

## 2. Live runtime hardening

The TrueForge path added:

- exactly three named diagnostics in one fan-out;
- bounded structured causal output shared by specialists and supervisor;
- non-authoritative diagnostic observations grounded in same-thread tool results plus application-owned root-cause promotion;
- Daytona-only repository execution;
- exact incident and head `get_commit` binding;
- application-owned bootstrap, patch-capture, and verifier manifests;
- patch-digest-bound independent review;
- durable turn/session/cursor recovery;
- streamed tool-call correlation;
- semantic checkpointing instead of per-delta full-state rewrites;
- bounded event commits, generation drain, cancellation, and terminal persistence;
- fail-closed continuation and external approval handling.

The historical incident bootstrap was aligned with its authoritative CI: the old revision has no lockfile and therefore installs with `--no-frozen-lockfile`, while current repository CI remains frozen.

## 3. Qodo-driven reliability work

Repeated Agentic Review passes found and verified fixes for stale approvals/certificates, reconciliation identity, cursor durability, timeout races, event-journal ordering, terminal persistence, cancellation retry, GitHub response binding, serialized prompt expansion, and fabricated root-cause promotion.

The final causal changes reject both the unsafe equivalence between symptom reproduction and diagnosis and promotion of unresolved model-authored references. Exact context plus exact reproduction remains pending. A named specialist must supply a bounded cause and causal mechanism whose references resolve to earlier successful tool results in that specialist thread; the application then performs exact-evidence correlation before PASS.

One High remains intentionally open: TrueForge SDK `0.1.3` lacks a per-dynamic-subagent pre-execution tool policy. EvidenceForge documents the boundary rather than pretending post-event rejection prevents execution.

The final documentation review also corrected the demo reset command and separated executable-candidate CI from the external exact-final-head check.

## 4. UI and accessibility

The console evolved into an evidence-control-plane dossier rather than a chat transcript. It provides explicit activity semantics, approval controls, certified completion, task-scoped SSE, durable snapshot reconstruction, focus/skip/live-region support, long-value handling, reduced motion, and responsive layouts.

The finalization pass identified insufficient contrast in inactive timeline labels/numbers and input placeholders. A shared muted color now clears 4.5:1 on both dark application surfaces, with a deterministic contrast test.

The 320/375/768/1024/1440 geometry had already been browser-observed. No later change alters geometry. Exact 200% browser zoom remains a manual check.

## 5. Verification result

The exact executable code head passes the complete frozen GitHub Actions matrix:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test                  231/231
pnpm eval:smoke
pnpm demo:fixture
pnpm build
pnpm doctor
git diff --check
```

The deterministic evaluation remains 0% false success for EvidenceForge versus 57.14% for the unenforced baseline.

The commit containing this journal must run the same matrix after publication; that self-referential exact-head result is recorded externally in PR #2 rather than predeclared here.

## 6. Live evidence result

The strongest credentialed TrueForge run reached 9/10 application gates. It passed incident context, reproduction, root cause, regression, targeted tests, typecheck, lint, diff integrity, and independent review.

`external-pr` remained pending/blocked. An invalid `base: main` request and missing head read were stopped before write; a later attempt was stopped when a specialist exceeded its budget. No wrong PR, automatic approval, or merge occurred.

The deterministic fixture completes 10/10 and issues a CompletionGate certificate. It is not represented as live sponsor evidence.

## 7. Final release boundary

Repository code, tests, executable CI, Qodo remediation, and documentation are finalized on the feature branch. Remaining work requires external observation, credentials, or human authority:

- exact final-head CI and Qodo after this commit;
- exact 200% zoom;
- stable live approval/write/reconciliation/certificate path;
- demo video;
- human squash merge;
- official submission.
