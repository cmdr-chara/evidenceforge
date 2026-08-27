# The Agent Said It Was Fixed. The Tests Disagreed: Building an Evidence-Gated Agent with TrueForge

> Draft status — 2026-08-27: implementation-backed sections retain the last exact-SHA GitHub Actions/Qodo baseline. Genuine TrueForge/model and GitHub MCP read observations now exist, plus separate Daytona connectivity/exec evidence. The newer candidate's exact-head CI, end-to-end Daytona reproduction, live approval/PR, and demo remain explicitly open.

## 1. Why “agent says done” is not a completion criterion

Agent systems often use the same model to make a change and assess whether the change worked. That creates a circular authority problem: confidence, plausibility, or a reviewer-style summary can become a substitute for an oracle.

EvidenceForge separates execution from completion. The model investigates, proposes hypotheses, edits code, and requests tools. A deterministic application layer owns the success contract, evidence admissibility, verifier results, risk policy, and final state transition.

> The model can propose success. It cannot issue the completion certificate.

## 2. TrueForge is the runtime; EvidenceForge is the control plane

TrueForge owns the agent execution loop, model integration, MCP, sandbox, dynamic subagents, sessions, streamed events, context management, and human tool approval. EvidenceForge does not replace TrueForge with another orchestration framework.

EvidenceForge adds CI-incident-specific control:

- versioned success contracts;
- evidence provenance and subject binding;
- deterministic verifier correlation;
- patch/review/approval invalidation;
- external-action identity and reconciliation;
- recovery semantics;
- terminal cutoff;
- CompletionGate certificate issuance;
- an incident console designed around state/evidence rather than chat.

## 3. Completion integrity

The certificate accepted by the state machine is bound to:

- task ID;
- repository;
- failing revision;
- patch digest;
- state version;
- success-contract digest;
- canonical state digest;
- canonical subject digest;
- trace ID;
- exact reconciled PR identity when publishing is required.

The certificate payload itself has a canonical digest. The object and all nested arrays/objects are deeply frozen. The state machine revalidates issuance identity, payload digest, and current subject before `COMPLETED` is allowed.

Changing the patch preserves incident-context/root-cause/reproduction evidence, but invalidates patch verification, independent review, round evaluation, old external approval/action, and the related external operation.

## 4. Evidence provenance

Evidence is classified as observation, reproduction, verification, review, or external result. Current verification evidence carries a binding to the task/repository/revision/success contract and an explicit scope:

- `INCIDENT` — remains valid across repatches when the incident itself did not change;
- `PATCH` — must match the current patch;
- `EXTERNAL` — must match the current patch and publishing subject.

Model prose remains inadmissible as deterministic PASS evidence.

## 5. Approval and exact PR identity

Pull-request creation is an external reversible action. Approval provenance binds the action digest, repository, revision, risk, originating operation, current external subject, issue time, expiry, and one-shot consumption.

The live server serializes the complete per-task decision path. A regression test submits two concurrent decisions and proves only one reaches the simulated external-submission section.

Reconciliation validates the exact prepared identity: repository, base branch, head branch, head SHA, operation ID, and idempotency key. A PR at the same commit but a different target is rejected.

## 6. Durable restart behavior

A normal TrueForge model message may arrive as a base event plus same-ID deltas that construct a tool call before a later `tool.response`. EvidenceForge now persists those deltas individually rather than deduplicating solely by event ID.

After restart, the projector rebuilds its event index from persisted raw event payloads. An integration test stops after the streamed tool-call construction, recreates the projector, then correlates the later response and produces the deterministic verifier result.

Completed-turn resume also skips history at or before the durable cursor and persists the maximum sequence number actually observed, preventing endless reprocessing of already completed turns.

## 7. Terminal correctness

Once a session is `BLOCKED`, `FAILED`, `ESCALATED`, or `COMPLETED`, late runtime events cannot mutate actionable state. The terminal event records a durable sequence cutoff; later buffered events are neither projected into actionable state nor included in the persisted checkpoint.

The live console reconstructs activity only through that cutoff. Terminal states are visually distinct from successful activity.

Malformed tool responses, explicit failures, and non-zero exits render as `ERROR`, not green success.

## 8. Persistence reliability

Session and checkpoint filenames are keyed by a SHA-256 digest of the full task ID, eliminating collisions such as `a/b` versus `a_b`. Writes use unique UUID temporary files and per-task serialization. The embedded task ID is validated on read.

Legacy sanitized filenames remain readable as a fallback. No destructive migration is performed.

## 9. Parallel diagnostics and the TrueForge SDK limitation

EvidenceForge's intended diagnostic topology is exactly three specialists:

1. Repository Investigator
2. Failure / Log Investigator
3. Dependency / Configuration Investigator

The critical limitation is now documented precisely. TrueForge SDK `0.1.3` exposes dynamic-subagent enablement, but the inspected API does **not** expose a per-dynamic-subagent pre-execution tool allowlist or interceptor. Because subagents share the parent runtime capabilities, EvidenceForge cannot truthfully claim hard prevention of a specialist mutating the shared sandbox before execution.

Prompt constraints and post-event detection are not equivalent to prevention. This remains an SDK-blocked Qodo High finding.

The minimum safe evolution is either a future TrueForge per-subagent tool policy or a narrow read-only proxy/tool surface supplied to diagnostic subagents, while mutation remains serialized in the TrueForge parent flow. No second orchestrator is introduced.

## 10. Evaluation correctness

The deterministic comparison uses one recovery-success definition for both the unenforced baseline and EvidenceForge. A recovery attempt succeeds only when the terminal state is genuinely `COMPLETED` and the replay/reconciliation policy was satisfied. `BLOCKED` and `ESCALATED` cannot inflate recovery-success metrics.

The existing 15-case comparison remains fixture control-policy evidence, not a claim about general model performance or live sponsor reliability.

## 11. Live activity and UI

The browser consumes a task-scoped SSE channel and receives a fresh persisted snapshot on reconnect. Browser-side task filtering is defense in depth.

The UI also includes:

- INFO / SUCCESS / WARNING / ERROR / BLOCKED activity semantics;
- visible focus and skip navigation;
- accessible log/live regions;
- full title/ARIA values for long revision/trace/digest fields;
- >=44px primary controls;
- reduced-motion handling;
- narrow responsive layouts down to 320px-class CSS rules.

The exact 320 / 375 / 768 / 1024 / 1440 px and 200% zoom matrix has **not** been visually exercised in the available browser environment, so it remains a manual presentation gate.

## 12. Qodo findings that changed the code

Qodo Agentic Review is genuine and public:

- PR #2: https://github.com/cmdr-chara/evidenceforge/pull/2
- aggregate review: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5417017502
- earlier follow-up request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5428521720
- final exact-SHA request: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5440874929
- Qodo exact-SHA update: https://github.com/cmdr-chara/evidenceforge/pull/2#issuecomment-5440921739

The reconstructed batch addresses the implementable open High/Medium findings with code and regression tests, including certificate mutability, stale approvals after repatch, incident-evidence preservation, approval race, completed cursor, exact PR reconciliation, persistence collisions/tempfiles, SSE cross-talk, recovery metrics, streamed restart correlation, failed-tool activity, and initial activity recovery.

The read-only pre-execution specialist boundary remains **BLOCKED by TrueForge SDK 0.1.3**, with rationale recorded in `docs/qodo-review-log.md`.

Qodo updated its aggregate review through implementation SHA `c57c5e4…`. The cursor/path, runtime transaction, terminal-durability, and cancellation-retry findings are resolved. The disclosed SDK-blocked read-only boundary remains open separately.

## 13. Verified repository result

Latest verified implementation SHA `c57c5e424054af04c999bd2c144e09b8d54d0622` passed GitHub Actions runs `33101668750` and `33101672505` with:

- frozen-lockfile install;
- format;
- lint;
- strict typecheck;
- **202/202 tests**;
- evaluation smoke;
- healthy demo fixture;
- build;
- doctor;
- `git diff --check`.

These results prove the last externally verified repository baseline only. A later credentialed TrueForge/model turn (`01m11zp6dfp08dq520eqsp9cdx` / `01m11zp6dyt1xq08qwdkzdns1h.local`) used the official GitHub MCP `get_commit` tool and returned the exact repository SHA; Daytona connectivity and command execution were observed separately. Those component observations do not prove the end-to-end incident-resolution path or hackathon sponsor acceptance.

## 14. Demo vertical slice still required

The approximately three-minute live demo should show:

1. a real failed GitHub Actions run and exact revision;
2. a credentialed TrueForge EvidenceForge session;
3. GitHub MCP retrieving authoritative context;
4. the three diagnostic specialists;
5. Daytona reproducing the failure at the exact revision;
6. serialized patch creation and patch digest;
7. deterministic verification and independent review;
8. a real `tool.approval_required` pause showing exact PR arguments;
9. human approval;
10. the real PR and exact reconciliation;
11. CompletionGate issuing the completion certificate;
12. browser reconnect restoring the task-scoped snapshot.

The specialist read-only pre-execution limitation should be described accurately rather than hidden.

## 15. Limitations

- Credentialed sponsor infrastructure has not yet been executed in the current environment.
- TrueForge SDK `0.1.3` cannot enforce the desired per-dynamic-subagent read-only tool policy before execution.
- Persistence is single-node JSON with application serialization, not a distributed transactional database.
- The evaluation corpus is deterministic and too small for generalization claims.
- Exact 320/375/768/1024/1440 viewport validation is observed clean; exact 200% browser zoom remains manual because the browser-control surface does not expose zoom.
- The P0 policy deliberately does not merge, deploy, delete, or perform privileged actions.

## 16. Production roadmap

A production version would add transactional multi-writer persistence, multi-tenant authorization, signed artifact provenance, stronger sandbox/network capability boundaries, repository-specific contract templates, larger live evaluation corpora, cost/latency telemetry, and incident-system integrations—without relaxing the certificate-only completion invariant.
