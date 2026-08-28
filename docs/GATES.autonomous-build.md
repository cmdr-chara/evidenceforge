# Autonomous build gate ledger

**Last synchronized:** 2026-08-28

Status values: `PASS`, `BLOCKED`, `PENDING_REVIEW`, `MANUAL`.

## Verified implementation baseline

Latest technical implementation SHA `aed84feb7205d7b66a13804fc2fb8f4184f2324f`
passed GitHub Actions runs `33155806482` and `33155815342`, including 204/204
tests. The latest observed Qodo aggregate is through `3e3a06e…`; exact-head review
is intentionally left open until the final documentation commit exists.

| Gate | Status | Evidence / blocker |
|---|---|---|
| Existing feature branch only | PASS | `feat/foundation-control-plane`; no alternate branch created |
| Default branch untouched directly | PASS | PR #2 continues to target `determination` |
| `.evidenceforge/` preserved/ignored | PASS | ignore rule retained; format/lint also exclude it; no migration/deletion committed |
| Frozen dependency install | PASS | `pnpm install --frozen-lockfile` in exact-SHA CI |
| Format | PASS | exact-SHA CI |
| Lint | PASS | exact-SHA CI |
| Typecheck | PASS | exact-SHA CI |
| Test suite | PASS | 204/204 on exact-SHA push and PR CI |
| Eval smoke | PASS | exact-SHA CI |
| Demo fixture | PASS | exact-SHA CI; fixture is not live sponsor evidence |
| Build | PASS | exact-SHA CI |
| Doctor | PASS | exact-SHA CI |
| Diff integrity | PASS | `git diff --check` in exact-SHA CI |
| Certificate-only completion | PASS | state machine rejects direct completion; CompletionGate certificate required |
| Certificate subject identity | PASS | task/repository/revision/patch/version/contract/state/subject digests checked |
| Certificate payload integrity | PASS | canonical payload digest + deep immutability + mutation regression test |
| Repatch invalidation | PASS | patch/review/external evidence and stale external approval/action/operation invalidated; INCIDENT evidence retained |
| Approval decision serialization | PASS | per-task serialized decision path + concurrent-decision regression |
| Approval provenance | PASS | exact arguments/repository/revision/risk/operation/current EXTERNAL binding |
| Official GitHub MCP contract | PASS | official create/read fields only; application metadata never sent to MCP; create yields receipt, not completion evidence |
| Exact PR reconciliation | PASS | later authoritative read checks repository/base/head/head SHA/operation/idempotency; wrong-target regression |
| Completed resume cursor | PASS | skips persisted history and advances maximum observed sequence |
| Streamed tool-call restart | PASS | checkpointed message/deltas rehydrate correlation before later `tool.response` |
| Terminal cutoff | PASS | actionable late events ignored and omitted from persisted checkpoint after cutoff |
| Tool failure observability | PASS | malformed/nonzero/error responses render ERROR rather than SUCCESS |
| Initial activity recovery | PASS | `Incident accepted` deterministically reconstructed after restart |
| Persistence collisions | PASS | SHA-256 keyed filenames; `a/b` vs `a_b` regression |
| Unique tempfiles / write serialization | PASS | UUID tempfiles and per-task write chains |
| Legacy persistence read fallback | PASS | old sanitized filename remains readable without destructive migration |
| Recovery metric semantics | PASS | baseline and EvidenceForge both require real `COMPLETED`; BLOCKED/ESCALATED not success |
| SSE task isolation | PASS | server channel scoped by task; reconnect reloads task snapshot; browser filters mismatches |
| UI semantic/a11y hardening | PASS | code + CI: focus, skip link, live/log semantics, tone distinction, reduced motion, long-value labels, >=44px primary controls |
| Exact viewport visual matrix | PASS | 320/375/768/1024/1440 observed in the in-app browser; no page-level horizontal overflow; 768 section boundaries inspected without overlap |
| Exact 200% browser zoom | MANUAL | browser automation does not expose a zoom control; 640px equivalent reflow had no page-level overflow but is not represented as an exact zoom observation |
| TrueForge dynamic-subagent read-only prevention | BLOCKED | SDK 0.1.3 exposes no per-subagent pre-execution tool allowlist/interceptor |
| Credentialed TrueForge live session | PASS | session `01m11zp6dfp08dq520eqsp9cdx`; model turn `01m11zp6dyt1xq08qwdkzdns1h.local` observed |
| Live GitHub MCP read | PASS | official `get_commit` returned exact SHA `7555f0f0…` in the observed TrueForge turn |
| Live Daytona connectivity/exec | PASS | provider connection and successful command execution observed separately; not a reproduction claim |
| Real failing GitHub Actions incident | PASS | run `33153999792` failed at exact revision `18668095…` with the stable configuration-order regression |
| Three live TrueForge specialists | PASS | task `task-2a0444d3…`; raw TrueForge events contain exactly three `thread.created` and three `thread.done` events |
| Live Daytona failing-revision reproduction | BLOCKED | the full turn ended with provider HTTP 402 `Insufficient Balance` before admissible reproduction evidence committed |
| Live skill materialization | PASS | four configured skills were observed in a credentialed TrueForge session |
| Live human approval pause/resume | BLOCKED | requires live runtime event |
| Real PR created by EvidenceForge | BLOCKED | requires live TrueForge/MCP and human authorization |
| Latest Qodo re-review | PENDING_REVIEW | latest observed update is through `3e3a06e…`; request again after the final documentation commit |
| Human merge | BLOCKED | PR #2 must remain unmerged until human decision |
| Demo video/publication/submission | BLOCKED | requires live sponsor evidence and human account actions |

## Qodo finding gate

Observed aggregate review: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502

Qodo updated its aggregate through SHA `c57c5e4…` and marks initial-turn cursor durability, exact file-path binding, bounded generation drain, explicit terminal-durability failure, cancellation retry, approval uncertainty, and journal-first admission resolved. The read-only pre-execution specialist boundary remains **BLOCKED** for the SDK reason documented in `docs/qodo-review-log.md`.

## Release decision

The repository candidate is **CONDITIONAL**, not fully complete for hackathon
submission. TrueForge/model, GitHub MCP, Daytona, and exactly three live specialists
have genuine observations, but model-provider balance blocked the completed vertical
slice. Remaining conditions include exact-head CI/Qodo after the documentation
commit, the SDK-blocked read-only boundary, exact 200% zoom, failing-revision
reproduction, live approval/PR/reconciliation, demo/publication, human merge, and
submission.
