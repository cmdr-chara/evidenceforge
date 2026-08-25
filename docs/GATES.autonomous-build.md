# Autonomous build gate ledger

**Last updated:** 2026-08-25T19:16:00Z

Status values: `PASS`, `FAIL`, `BLOCKED`, `UNKNOWN`.

| Gate | Acceptance evidence | Status | Observed evidence / blocker |
|---|---|---|---|
| Repository inspected first | default branch and commit history observed | PASS | Public repo was empty; default `determination`; no commits |
| Bootstrap minimal | one minimal bootstrap commit | PASS | `chore: bootstrap repository`, README only |
| Feature branch | substantive work off default branch | PASS | `feat/foundation-control-plane` created |
| Current rules verified | official hackathon, TrueForge, Qodo, MCP sources | PASS | `docs/hackathon-requirements.md` |
| Domain schemas | strict TypeScript models and validation | PASS | `packages/domain` compiles |
| Model cannot complete | direct completion transition rejected | PASS | unit test passes |
| Required criteria enforced | missing/FAIL/INCONCLUSIVE rejected | PASS | unit tests pass |
| Verifier correlation | latest PASS result must match verifier and admissible evidence | PASS | dedicated correlation tests pass |
| Retry recovery | later deterministic PASS supersedes an earlier failed attempt | PASS | retry recovery test passes |
| Evidence provenance | unknown event and model-only evidence rejected | PASS | unit tests pass |
| Deterministic failure wins | latest deterministic FAIL overrides reviewer PASS | PASS | unit test passes |
| Risk policy | read, sandbox, external, destructive, privileged, unknown | PASS | policy tests pass |
| Approval denial | no external publish after denial | PASS | unit and demo integration tests pass |
| External reconciliation | required external criterion needs reconciled verifier-linked evidence | PASS | unit tests pass |
| Exactly 3 specialists | read-only shared-workspace fan-out | PASS | topology tests pass |
| Reviewer isolation | patching transcript excluded | PASS | reviewer-definition test passes |
| Bounded recovery | retries, patch attempts, replans | PASS | recovery/failure-injection tests pass |
| Safe escalation | unresolvable case ends `ESCALATED` | PASS | S5 scenario passes |
| Persistent domain state | atomic save/load with TF cursor | PASS | integration test passes |
| TrueForge SDK adapter | current session/turn/approval/resume API encoded | PASS | compiles and agent-spec test passes |
| TrueForge live session | real server session and turn | BLOCKED | no server/model credentials available |
| GitHub MCP live read | real run context | BLOCKED | connector not configured inside TrueForge |
| Daytona live command | exact revision command event | BLOCKED | Daytona credentials not available |
| TrueForge skills live load | skill materialization in sandbox | BLOCKED | live runtime unavailable |
| Human approval live pause | real `tool.approval_required` event | BLOCKED | live runtime unavailable |
| Real PR after approval | GitHub external write and reconciliation | BLOCKED | requires live TrueForge/MCP and explicit human approval |
| Incident console | phase, contract, specialists, evidence, approval, certificate | PASS | HTTP/API smoke and integration test |
| Deterministic fixture | healthy/resettable config-order case | PASS | 3 fixture tests pass |
| Test suite | no failures | PASS | 62 / 62 EvidenceForge tests |
| Evaluation | five cases and FSR | PASS | FSR 0.00; S5 escalated |
| Lint/typecheck/format | GitHub Actions checks | PASS | run `32888513388` passed all three checks |
| CI green | GitHub Actions run | PASS | run `32888513388` completed successfully: install, format, lint, typecheck, 62 tests, smoke evaluation, and demo fixture |
| Qodo review | genuine initial and follow-up review | BLOCKED | `/agentic_review` requested twice on PR #2, but no Qodo review response has been observed |
| Demo video | approximately 3 minutes | BLOCKED | live sponsor run required first |
| Submission | official form complete | BLOCKED | depends on live evidence and human submission |

## Minimum human actions for blocked P0 gates

1. Install or authorize Qodo for `cmdr-chara/evidenceforge`.
2. Configure a TrueForge server with a model, GitHub MCP, Daytona, and the four skills.
3. Approve the prepared demo-branch push and later the exact PR creation action.
4. Run and preserve the live smoke, Qodo, PR, and reconciliation evidence.
5. Record/upload the demo and complete the submission form.
