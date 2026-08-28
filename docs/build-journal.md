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

Repeated Agentic Review passes found and verified fixes for stale approvals/certificates, reconciliation identity, cursor durability, timeout races, event-journal ordering, terminal persistence, cancellation retry, and GitHub response binding.

The finalization pass fixed one additional Medium: raw task text could fit the nominal prompt cap while JSON escaping expanded it beyond the cap. Validation now measures serialized prompt text and includes a control-character regression.

One High remains intentionally open: TrueForge SDK `0.1.3` lacks a per-dynamic-subagent pre-execution tool policy. EvidenceForge documents the boundary rather than pretending post-event rejection prevents execution.

## 4. UI and accessibility

The console evolved into an evidence-control-plane dossier rather than a chat transcript. It provides explicit activity semantics, approval controls, certified completion, task-scoped SSE, durable snapshot reconstruction, focus/skip/live-region support, long-value handling, reduced motion, and responsive layouts.

The finalization pass identified insufficient contrast in inactive timeline labels/numbers and input placeholders. A shared muted color now clears 4.5:1 on both dark application surfaces, with a deterministic contrast test.

The 320/375/768/1024/1440 geometry had already been browser-observed. No later change alters geometry. Exact 200% browser zoom remains a manual check.

## 5. Verification result

The executable candidate passes the complete frozen GitHub Actions matrix:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test                  220/220
pnpm eval:smoke
pnpm demo:fixture
pnpm build
pnpm doctor
git diff --check
```

The deterministic evaluation remains 0% false success for EvidenceForge versus 57.14% for the unenforced baseline.

## 6. Live evidence result

The strongest credentialed TrueForge run reached 9/10 application gates. It passed incident context, reproduction, root cause, regression, targeted tests, typecheck, lint, diff integrity, and independent review.

`external-pr` remained pending/blocked. An invalid `base: main` request and missing head read were stopped before write; a later attempt was stopped when a specialist exceeded its budget. No wrong PR, automatic approval, or merge occurred.

The deterministic fixture completes 10/10 and issues a CompletionGate certificate. It is not represented as live sponsor evidence.

## 7. Final release boundary

Repository code, tests, CI, Qodo remediation, and documentation are finalized on the feature branch. Remaining work requires external credentials or human authority:

- exact 200% zoom;
- stable live approval/write/reconciliation/certificate path;
- demo video;
- final Qodo inspection after the documentation commit;
- human squash merge;
- official submission.
