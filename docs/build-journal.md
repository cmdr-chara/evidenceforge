# Build journal

This journal records observed work and failures. It intentionally omits private reasoning and never promotes fixture output into sponsor evidence.

## 2026-08-25 — bootstrap and first control plane

Observed:

- public repository started on default branch `determination`;
- substantive work moved to `feat/foundation-control-plane`;
- PR #2 opened against `determination`;
- deterministic domain state, evidence store, verifier engine, CompletionGate, risk/approval policy, recovery logic, TrueForge adapter, incident console, fixture, and evaluation corpus were implemented;
- early CI setup failures around pnpm ordering/cache were diagnosed and fixed rather than hidden;
- test counts grew through multiple verified intermediate candidates as controls were hardened.

The 15-case deterministic comparison was introduced as control-policy evidence. Its fixture metrics are deliberately not described as live model or sponsor-runtime performance.

## 2026-08-26 — Qodo-driven hardening

A genuine Qodo Agentic Review appeared on PR #2:

- aggregate review: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- earlier follow-up request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5428521720

The earlier P0.1 batch fixed Qodo's stale-certificate and old-patch-evidence findings and was published before the larger reconstruction.

A later coordinated P0/P1/P2 attempt was interrupted after creating several candidate Git blobs but before a verified functional push. The surviving candidate source was preserved under `recovery/2026-08-27-p0-p2-wip/` rather than discarded or falsely represented as complete.

## 2026-08-27 — durable reconstruction

The reconstruction was resumed from the recovery commit and **every work block was immediately committed to the existing feature branch**. No new branch and no merge were used.

### Completion/evidence integrity

Implemented and saved:

- explicit INCIDENT / PATCH / EXTERNAL evidence scopes;
- task/repository/revision/patch/state/contract bindings;
- canonical completion state/subject/payload digests;
- deep-immutable CompletionGate certificate;
- certificate payload revalidation at state transition;
- repatch preservation of incident/root-cause/reproduction evidence;
- invalidation of patch verification, review, stale external approval/action/operation on repatch.

Regression coverage includes nested certificate mutation, stale certificate state, stale approval invalidation, and incident-evidence preservation.

### Approval and exact PR identity

Implemented and saved:

- per-task serialized approval decision path across load → validate → decide → persist → submit → persist;
- concurrent-decision regression proving only one submission path enters;
- approval provenance bound to current patch subject;
- external-action identity bound to action digest and operation/idempotency identity;
- reconciliation checks repository, base, head, head SHA, operation ID, and idempotency key;
- same commit on a different PR target is rejected.

### Durable recovery and terminal correctness

Implemented and saved:

- full streamed model-message deltas retained in evidence history;
- projector rehydrates tool-call correlation from persisted events after restart;
- completed-turn replay skips sequence numbers already persisted and advances to the maximum observed sequence;
- restart-before-tool-response regression;
- durable terminal cutoff: late actionable events do not mutate or persist after BLOCKED/FAILED/ESCALATED/COMPLETED;
- terminal cursor remains pinned to the cutoff;
- initial `Incident accepted` live activity reconstructs from persisted task state;
- malformed/nonzero/failed tool responses render ERROR, never green SUCCESS.

### Persistence reliability

Implemented and saved:

- SHA-256 task-keyed filenames;
- unique UUID tempfiles;
- per-task serialized writes;
- embedded task-ID validation;
- legacy sanitized filename read fallback with no destructive migration;
- regression for `a/b` versus `a_b` and concurrent saves.

### Evaluation correctness

Recovery success now has one definition for both the baseline and EvidenceForge: an uncertain effect counts as recovered only when the terminal outcome is genuinely `COMPLETED` and the replay/reconciliation policy is satisfied. `BLOCKED` and `ESCALATED` never count as successful recovery.

### UI/live activity

Implemented and saved without new UI dependencies:

- task-scoped SSE channels;
- persisted snapshot reload on reconnect;
- browser defense-in-depth task filtering;
- explicit INFO / SUCCESS / WARNING / ERROR / BLOCKED activity semantics;
- >=44px primary controls;
- long SHA/revision/trace values expose full title/ARIA values;
- focus visibility, skip link, accessible log/live regions;
- custom scrollbar/reduced motion retained;
- narrow viewport overrides down to 320px-class layouts.

The exact 320/375/768/1024/1440px + 200% visual matrix was **not browser-observed** in this execution environment and remains a manual gate.

### TrueForge specialist isolation investigation

TrueForge SDK `0.1.3` declarations were inspected directly. Dynamic subagents can be enabled, but the SDK exposes no per-dynamic-subagent pre-execution tool allowlist/interceptor. Therefore Qodo's read-only specialist boundary finding remains **BLOCKED**, not falsely fixed.

The minimum safe architecture is a future TrueForge per-subagent tool policy or a read-only proxy/tool surface for specialists while mutation remains serialized in the parent. TrueForge remains the runtime; no competing orchestration framework was added.

## Verified CI baseline

Implementation SHA:

`628d4db9a19e50b142051fe3ae2793b0b9b704ad`

GitHub Actions run:

`33083635762`

Observed green steps:

- `pnpm install --frozen-lockfile`;
- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test` — **159 / 159 passed**;
- `pnpm eval:smoke`;
- `pnpm demo:fixture`;
- `pnpm build`;
- `pnpm doctor`;
- `git diff --check`.

This is the first fully green reconstructed implementation baseline. Documentation changes after that SHA require their own final exact-head CI before handoff.

## Remaining external/human gates

- final exact-head GitHub Actions after documentation synchronization;
- final Qodo `/agentic_review` and response on that exact SHA;
- P0.4 pre-execution specialist isolation capability in TrueForge (SDK-blocked today);
- credentialed TrueForge + model + GitHub MCP + Daytona vertical slice;
- exact viewport/200% visual observation;
- real approval pause, real PR write, and exact reconciliation from the live path;
- approximately three-minute demo/publication;
- human merge;
- official submission.

PR #2 remains open and unmerged. No blocked live, Qodo, merge, or submission gate is recorded as complete without observed evidence.
