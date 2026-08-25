# Autonomous build gate ledger

**Last updated:** 2026-08-25T23:06:00+02:00

Status values: `PASS`, `FAIL`, `BLOCKED`, `UNKNOWN`.

| Gate | Acceptance evidence | Status | Observed evidence / blocker |
|---|---|---|---|
| Repository inspected first | default branch and commit history observed | PASS | Public repo was empty; default `determination`; bootstrap history established before substantive work |
| Bootstrap minimal | one minimal bootstrap commit | PASS | `chore: bootstrap repository`, README only |
| Feature branch | substantive work off default branch | PASS | `feat/foundation-control-plane` |
| Current rules verified | official hackathon, TrueForge, Qodo, MCP sources | PASS | `docs/hackathon-requirements.md` |
| Domain schemas | strict TypeScript models and validation | PASS | `packages/domain` is covered by typecheck/tests |
| Model cannot complete | direct completion transition rejected | PASS | deterministic unit coverage |
| Required criteria enforced | missing/FAIL/INCONCLUSIVE rejected | PASS | deterministic unit coverage |
| Verifier correlation | latest PASS must match verifier and admissible evidence | PASS | correlation and restart-rehydration coverage |
| Retry recovery | later deterministic PASS can supersede an earlier failed attempt | PASS | recovery coverage |
| Evidence provenance | unknown event and model-only evidence rejected | PASS | provenance coverage |
| Deterministic failure wins | deterministic FAIL overrides reviewer PASS | PASS | unit coverage |
| Risk policy | read, sandbox, external, destructive, privileged, unknown | PASS | policy coverage |
| Exact approval binding | approval matches exact action, risk, reversibility, and normalized arguments | PASS | substitution/replay coverage |
| Approval denial | no external publish after denial | PASS | unit and demo integration coverage |
| External reconciliation | required external criterion needs reconciled verifier-linked evidence | PASS | unit coverage |
| Exactly 3 specialists | read-only diagnostic fan-out | PASS | topology coverage |
| Reviewer isolation | patching transcript excluded | PASS | reviewer-definition coverage |
| Bounded recovery | retries, patch attempts, replans | PASS | recovery/failure-injection coverage |
| Safe escalation | unresolvable case ends `ESCALATED` | PASS | deterministic evaluation coverage |
| Persistent domain state | atomic session/evidence checkpoints and restart restoration | PASS | persistence and TrueForge restart tests |
| TrueForge SDK adapter | sessions, turns, approvals, reconnect/replay, event normalization | PASS | compile/tests and current CI |
| TrueForge live session | real server session and model turn | BLOCKED | no credentialed TrueForge/model environment is available from this build environment |
| GitHub MCP live read | real incident context through TrueForge MCP | BLOCKED | GitHub MCP is not configured inside a reachable credentialed TrueForge runtime |
| Daytona live command | exact-revision repository command through TrueForge sandbox | BLOCKED | Daytona-backed live runtime credentials are unavailable |
| TrueForge skills live load | skills materialized by live harness | BLOCKED | requires the credentialed live runtime |
| Human approval live pause | real `tool.approval_required` event | BLOCKED | requires the credentialed live runtime |
| Real PR after EvidenceForge approval | external write and reconciliation through the live flow | BLOCKED | requires live TrueForge/MCP plus explicit human approval |
| Incident console | phase, contract, specialists, evidence, approval, certificate | PASS | HTTP/API and integration coverage |
| Deterministic fixture | healthy/resettable configuration-order case | PASS | fixture workflow and tests |
| Test suite | no failures on current branch | PASS | current-head GitHub Actions CI completed successfully and executes `pnpm test` |
| Evaluation | false-success and escalation cases execute in CI | PASS | current-head CI executes `pnpm eval:smoke` successfully; detailed measured results remain in `docs/EVALUATION.md` |
| Lint/typecheck/format | repository checks | PASS | current-head CI executes format, lint, and typecheck successfully |
| CI green | GitHub Actions run on current head | PASS | hardening candidate `5b0e2e4d41f26975ca9b190fe873935ea42ba88d` passed push/PR runs `32898802584` and `32898808554`; ledger head `9093e9ee90d4f405ff81d31e95e4380827f2c6ae` passed push/PR runs `32898949166` and `32898953732`; final exact-head status is also checked in GitHub before handoff |
| Qodo review | genuine initial and follow-up review | BLOCKED | `/agentic_review` was requested repeatedly on PR #2; GitHub still exposes no Qodo review submission or review comment |
| Demo video | approximately 3–5 minutes with real sponsor path | BLOCKED | truthful live sponsor run is required before recording the requested end-to-end demo |
| Human merge | reviewed PR merged by human authority | BLOCKED | PR #2 is open and mergeable; Qodo/live acceptance gates remain open |
| Submission | official form complete | BLOCKED | requires live evidence, demo/publication assets, and human account action |

## Harness-hardening completion ledger (2026-08-25)

Status values: `OPEN`, `PASS`, `BLOCKED`, `WAIVED`.

| Gate | Check / deciding evidence | Expectation | Status |
|---|---|---|---|
| H1 Replay and durable operation protocol | deterministic unit and crash-boundary integration tests | replay metadata is persisted; uncertain effects are replayed, reconciled, or stopped strictly by policy | PASS |
| H2 Round verification and stop guard | adversarial completion/stop tests | every meaningful round classifies criteria/evidence and natural success is impossible without a current issuable certificate | PASS |
| H3 No-progress detection | equivalent-attempt and bounded-escalation tests | repeated attempts without new state/evidence route reconsider → replan → escalate | PASS |
| H4 Narrow mutation semantics | exact-target, ambiguity, overlap, base-state, serialization, and digest tests | mutations fail closed and emit verifiable patch metadata | PASS |
| H5 Approval provenance | substitution, stale revision, expiry, origin, and one-shot tests | an approval authorizes exactly one matching operation and cannot be replayed | PASS |
| H6 Evidence/context separation | compaction and checkpoint-restart tests | bounded model context never replaces or destroys authoritative evidence | PASS |
| H7 Recovery correctness | restart tests around intent/effect/settlement boundaries | recovery has an explicit durable program counter and legal next action | PASS |
| H8 Comparative evaluation | `pnpm eval:smoke` and report inspection | same deterministic corpus reports baseline and gated metrics without fabricated live measurements | PASS |
| H9 Documentation synchronization | architecture/security/evaluation/ADR/journal/gate review | adopted/rejected reference ideas, TrueForge boundary, methodology, results, and blockers are truthful | PASS |
| H10 Integrated verification | full local check ladder, dependency audit, exact-head GitHub CI | all applicable checks pass on the pushed candidate SHA | PASS |
| H11 Qodo and human/external gates | GitHub PR reviews/checks and live runtime artifacts | remains `BLOCKED` unless public/runtime evidence appears; no merge without human authorization | BLOCKED |

## Minimum human/external actions for blocked P0 gates

1. Install or authorize Qodo for `cmdr-chara/evidenceforge` so Agentic Review can actually respond on PR #2.
2. Provide or configure a reachable TrueForge server with a supported model, GitHub MCP, Daytona sandbox provider, and the four EvidenceForge skills.
3. Run the real failed-GitHub-Actions → TrueForge → GitHub MCP → Daytona reproduction/patch/verification flow and preserve runtime evidence.
4. Approve the exact external PR action when the live workflow pauses, then reconcile the resulting GitHub state.
5. Resolve genuine Qodo findings, rerun Qodo on the final candidate, and have a human merge only after required gates pass.
6. Record/upload the truthful demo and complete the external hackathon publication/submission steps.

No blocked sponsor, review, approval, merge, or submission gate is represented as complete without observed evidence.
