# Autonomous build gate ledger

**Last synchronized:** 2026-08-28

Status values: `PASS`, `PARTIAL`, `BLOCKED`, `MANUAL`.

The exact final SHA, exact-head CI URL, and post-commit Qodo request are maintained in [PR #2](https://github.com/cmdr-chara/evidenceforge/pull/2). A file inside the repository cannot truthfully embed the SHA of the commit that contains itself.

| Gate | Status | Evidence / blocker |
|---|---|---|
| Feature branch only | PASS | work remains on `feat/foundation-control-plane` |
| Default branch untouched directly | PASS | PR #2 targets `determination` |
| Published history preserved | PASS | no force push, rebase, or merge performed in finalization |
| Runtime state excluded | PASS | `.data/` and `.evidenceforge/` remain ignored and untracked |
| Normal frozen install | PASS | exact-head CI runs `pnpm install --frozen-lockfile` |
| Format | PASS | exact-head CI |
| Lint | PASS | exact-head CI |
| Typecheck | PASS | exact-head CI |
| Test suite | PASS | 220/220 on executable candidate; final docs head reruns the same matrix |
| Evaluation smoke | PASS | exact-head CI; fixture/control-policy evidence only |
| Demo fixture | PASS | exact-head CI; deterministic 10/10 certificate path |
| Build | PASS | exact-head CI |
| Doctor | PASS | exact-head CI placeholder/live-configuration validation |
| Diff integrity | PASS | `git diff --check` in exact-head CI |
| CompletionGate-only completion | PASS | direct/model/tool/reviewer completion paths are rejected |
| Certificate identity and integrity | PASS | task/repository/revision/patch/state/contract/subject/payload digests validated |
| Stale evidence/certificate rejection | PASS | exact-subject and current-state checks |
| Repatch invalidation | PASS | patch, verification, review, approval, action, and operation state invalidated |
| Approval provenance | PASS | exact arguments, operation, repository, revision, patch, expiry, one-time use |
| Approval race serialization | PASS | per-task serialized decision path |
| Durable operation settlement | PASS | intent/effect/settlement plus `EFFECT_UNCERTAIN` fail-closed handling |
| Exact PR reconciliation | PASS | repository/base/head/head SHA/operation/idempotency matched after authoritative read |
| Exactly three diagnostics | PASS | named one-fan-out topology and regression coverage |
| Bounded specialist budgets | PASS | violation blocks the task |
| Daytona-only repository execution | PASS | live manifests and policy require sandbox execution |
| Bootstrap before verification | PASS | application-owned manifest and sequencing tests |
| Patch capture before post-patch verification | PASS | exact `git diff --binary` manifest and binding |
| Patch-bound independent reviewer | PASS | isolated reviewer runs after deterministic verification |
| Streamed delta checkpoint policy | PASS | deltas journal/project without per-fragment full checkpoint; semantic boundaries persist |
| Continuation safety | PASS | latest durable `TURN_DONE`; terminal/stale/approval/action states rejected |
| Terminal durability | PASS | terminal save failure surfaces; stale ACTIVE checkpoint is not represented as durable BLOCKED |
| Supervisor GitHub MCP surface | PASS | only `get_commit`, `create_pull_request`, `pull_request_read`, preloaded |
| Dynamic-subagent pre-execution read-only enforcement | BLOCKED | SDK 0.1.3 exposes no per-subagent interceptor/allowlist |
| Deterministic fixture vertical slice | PASS | all gates, approval simulation, reconciliation, certificate |
| Credentialed live internal gates | PARTIAL | strongest run reached 9/10; all internal gates passed |
| Credentialed live `external-pr` | BLOCKED | no approved/reconciled live write observed |
| Wrong PR prevention | PASS | wrong base and missing head read blocked before write |
| Exact viewport matrix | PASS | 320/375/768/1024/1440 observed; later changes do not alter geometry |
| Small-text contrast | PASS | accessible muted color + deterministic >=4.5:1 test on both dark surfaces |
| Exact 200% zoom | MANUAL | unavailable through current connector/browser surface; not inferred |
| Qodo implementable findings | PASS | serialization expansion fixed; no open implementable Critical/High on code candidate |
| Qodo SDK boundary | BLOCKED | retained as genuine High limitation |
| Final post-commit Qodo exact-SHA record | MANUAL | external result linked in PR body/aggregate after this commit |
| Human merge | BLOCKED | PR #2 intentionally remains open/unmerged |
| Demo video and submission | BLOCKED | human/external account actions remain |

## Release decision

The repository candidate is **release-ready but not application-certified as a live completed incident**.

Repository CI, deterministic fixture, fail-closed control-plane behavior, documentation, and Qodo remediation can be finalized independently. Live `external-pr`, exact 200% zoom, video, human merge, and submission remain separate observed-evidence gates.
