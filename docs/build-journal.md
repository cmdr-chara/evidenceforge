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

### Credentialed runtime observations and live-contract hardening

A credentialed TrueForge/model turn was observed in session `01m11zp6dfp08dq520eqsp9cdx`, turn `01m11zp6dyt1xq08qwdkzdns1h.local`. Through TrueForge's meta-tool path, the model invoked the official GitHub MCP `get_commit` tool and received the exact repository SHA `7555f0f01f1af1f198d665333098619d05408230`. A separate credentialed session exposed the configured GitHub MCP tools, Daytona execution, four skills, dynamic subagents, and the approval gate. These are real component observations, not a completed incident-resolution run.

The application control plane was then hardened around the official GitHub MCP schema. Application-only identity fields are never sent to GitHub. `create_pull_request` produces only a minimal receipt; a later `pull_request_read`, bound to an earlier authoritative `get_commit` of the proposed head, must reconcile repository/base/head/head SHA before external evidence can commit. TrueForge stream deadlines now cover iteration, event callbacks, completed-turn replay, iterator cleanup, and session-creation failure, with durable fail-closed regressions.

The integrated unpublished candidate passes format, lint, typecheck, **196/196 tests**, evaluation smoke, fixture demo, build, CI-mode doctor, and diff integrity locally. It is not labeled an externally verified final SHA until publication and exact-head CI/Qodo observation.

Qodo's review of the first published hardening commit identified two additional Highs. GitHub file evidence had to bind repository/revision in the connector response, not merely in the request; plain file/directory payloads are now rejected unless an explicit trusted envelope carries both identities, while official `repo://…/sha/<commit>/…` resources remain supported. TrueForge callback deadlines also needed a runtime generation fence because `Promise.race` does not cancel the losing callback; a callback released after timeout is now prevented from journaling, persisting, cancelling, or notifying after terminal cutoff. Both paths have deterministic regressions and require exact-head Qodo confirmation after publication.

The next exact-SHA Qodo pass marked both of those Highs resolved and exposed two further edge cases. Event commits are now serialized and persisted while the stream remains active, so an initial `TURN_CREATED` ID/cursor/evidence survives a process interruption and can resume; failure closes admission, drains the single in-flight commit, then writes the terminal checkpoint before any queued late work. GitHub file evidence additionally requires the exact normalized requested path: files/resources must match it, and directory entries must be valid direct children without traversal or absolute-path ambiguity.

## Verified final branch baseline

Final branch SHA:

`7555f0f01f1af1f198d665333098619d05408230`

GitHub Actions run:

`33084240703` and `33084235854`

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

Both workflows passed on the final documentation/code SHA. Qodo then updated its aggregate review against the same SHA, resolving every implementable finding and retaining the SDK-blocked read-only High.

## Remaining external/human gates

- P0.4 pre-execution specialist isolation capability in TrueForge (SDK-blocked today);
- one credentialed TrueForge + model + GitHub MCP + Daytona vertical slice (individual component observations now exist);
- exact 200% browser zoom observation; the 320/375/768/1024/1440 viewport matrix is observed clean;
- real approval pause, real PR write, and exact reconciliation from the live path;
- approximately three-minute demo/publication;
- human merge;
- official submission.

PR #2 remains open and unmerged. No blocked live, Qodo, merge, or submission gate is recorded as complete without observed evidence.
