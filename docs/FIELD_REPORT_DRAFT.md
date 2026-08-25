# The Agent Said It Was Fixed. The Tests Disagreed: Building an Evidence-Gated Agent with TrueForge

> Draft status: implementation-backed sections are written. Live TrueForge, Qodo, GitHub MCP, and Daytona observations remain placeholders until genuine runs exist.

## 1. Why “agent says done” is not a completion criterion

Agent systems often use the same model to make a change and assess whether the change worked. That creates a circular authority problem: confidence, plausibility, or a reviewer-style summary can become a substitute for an oracle.

EvidenceForge separates execution from completion. The model investigates, proposes hypotheses, edits code, and requests tools. A deterministic application layer owns the success contract, evidence admissibility, verifier results, risk policy, and final state transition.

The core rule is simple:

> The model can propose success. It cannot issue the completion certificate.

## 2. What an agent harness does

A useful agent harness does more than relay chat messages. It manages model calls, tools, sandboxes, subagents, context, sessions, approvals, and observable events.

TrueForge provides that runtime boundary. EvidenceForge does not replace it with another orchestration framework. Instead, it adds domain control for CI incidents.

## 3. Why CI incident resolution

CI failures have several properties that make the completion problem concrete:

- authoritative external state exists in GitHub;
- logs can be large and misleading;
- repository execution is risky and needs isolation;
- the original failure can often be reproduced;
- tests, lint, typecheck, and diff checks offer deterministic oracles;
- publishing a pull request is an externally visible side effect;
- uncertainty is common and should be representable as escalation.

## 4. What TrueForge solved

The implementation uses current TrueForge concepts for:

- an inline agent spec with configurable model;
- GitHub MCP attachment;
- Daytona sandbox enablement;
- git-backed skills;
- dynamic subagents;
- context compaction and large-result offloading;
- bounded iteration;
- streamed runtime events;
- durable session/turn reconnect;
- human tool approval.

The live SDK adapter follows the documented session API and persists session ID, turn ID, and event sequence number.

**Live integration observations:** pending genuine runtime access.

## 5. What EvidenceForge added

EvidenceForge owns:

- the incident state machine;
- versioned success contracts;
- hypothesis status and evidence links;
- evidence kinds and provenance;
- verifier correlation;
- the CompletionGate;
- risk classification independent of MCP hints;
- external-action idempotency and reconciliation;
- task-specific recovery budgets;
- the incident console;
- false-success evaluation.

## 6. Success contracts

Before patching, the workflow defines what “done” means for the repository and incident. The primary fixture contract contains ten criteria: incident context, reproduction, root cause, regression, targeted tests, typecheck, lint, diff integrity, independent review, and reconciled pull request.

A criterion cannot become PASS because the model says it ran a command. Its evidence must point to a registered runtime event whose type and evidence kind are admissible for that verifier.

## 7. Evidence provenance

EvidenceForge distinguishes observation, reproduction, verification, review, and external result. That distinction matters:

- a GitHub job conclusion is an observation;
- a Daytona command recreating the failure is reproduction;
- a post-patch test result is verification;
- a reviewer verdict is review;
- GitHub confirming a PR at the expected SHA is an external result.

The evidence store rejects references to unknown runtime events. It also rejects model messages as verification sources.

## 8. Parallel investigations

The design uses exactly three diagnostic specialists:

1. Repository Investigator
2. Failure / Log Investigator
3. Dependency / Configuration Investigator

TrueForge's current design gives subagents isolated contexts but shared tools and sandbox. That is a useful performance characteristic and a dangerous mutation model. EvidenceForge therefore allows parallel reads but forbids parallel writes. Patching is serialized after aggregation.

A later reviewer receives an isolated summary, not the patching transcript.

## 9. Daytona reproduction

The intended live flow checks out the exact failing revision in Daytona, installs dependencies from the declared lockfile, runs the narrowest reproduction command, and captures exit code, duration, bounded output, and artifacts.

The deterministic fixture uses a configuration refactor where production validation runs before a test-mode fallback. The stable failure signature is `CONFIG_VALIDATION_ORDER`.

**Live Daytona evidence:** pending genuine credentials.

## 10. Verification

The verification engine correlates a criterion with a real tool event and evaluates exit code, signature, expected output, artifact references, or external state. A timeout becomes an explicit deterministic failure. A reviewer PASS does not override a failed command verifier.

The CompletionGate also requires a patch digest, successful failure reproduction, acceptable reviewer verdict, and reconciliation for any prepared external action.

## 11. Human approval

GitHub pull-request creation is classified as `EXTERNAL_REVERSIBLE`. The workflow prepares exact arguments, presents them to the human, and records allow or deny.

Denial produces `BLOCKED` and no certificate. Approval permits the write, but completion still waits for GitHub reconciliation.

## 12. Recovery

Failures are classified rather than treated as one retryable bucket:

- transient failures back off, at most twice;
- input errors allow corrected input;
- semantic failures trigger replan;
- approval denial blocks;
- environment failure recreates the sandbox at the exact revision;
- budget exhaustion escalates.

The intentionally ambiguous scenario proves that the agent can stop with insufficient evidence.

## 13. Qodo findings that changed the code

**Pending.** No genuine Qodo finding has been observed. This section will be populated only from the first PR's actual Agentic Review and follow-up review.

## 14. False-success evaluation

The current local evaluation runs 15 deterministic cases through the same-input unenforced baseline and EvidenceForge. Six oracle-resolvable cases complete under both; the baseline also falsely completes eight incomplete/unsafe cases. Baseline False Success Rate is 0.5714 versus 0.00 for EvidenceForge. These are fixture control-policy results, not live runtime or model claims.

The result is deliberately scoped. It does not claim general model performance or live sponsor reliability.

## 15. Development failures

Several implementation mistakes were caught rather than hidden:

- a server smoke command had incorrect shell backgrounding and ran curl too early;
- a lint assertion counted a type declaration as a fourth specialist;
- the first evaluation metric incorrectly counted escalation as successful reproduction.

The reproduction metric was corrected from 1.00 to 0.80. Keeping the less flattering number is part of the project's thesis.

## 16. Demo

The console makes the harness visible without requiring the audience to read model chat. It shows phase, criteria, specialists, hypotheses, evidence, diff, approval, and certificate.

Fixture mode is clearly labeled. Live mode is the submission target and must show real GitHub, Daytona, TrueForge, approval, and PR reconciliation events.

## 17. Limitations

- Live sponsor infrastructure has not yet been executed in the current environment.
- The persistence layer is single-node JSON, not a multi-writer database.
- The evaluation corpus is deterministic and remains too small for generalization claims.
- GitHub MCP tool names must be validated against the configured server.
- The P0 policy does not merge, deploy, delete, or perform privileged actions.

## 18. Production roadmap

A production version would add transactional persistence, multi-tenant authorization, signed artifact provenance, richer sandbox network policy, repository-specific contract templates, larger live evaluation corpora, cost/latency telemetry, and incident-system integrations—without relaxing the core completion invariant.
