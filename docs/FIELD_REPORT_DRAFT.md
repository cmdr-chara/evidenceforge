# EvidenceForge field report

## Executive summary

EvidenceForge is a TrueForge-based CI incident control plane designed to prevent false completion. Models diagnose and propose; application-owned evidence, deterministic verifiers, approval policy, external-state reconciliation, and CompletionGate decide.

The executable candidate passes the local verification matrix with 233 tests; exact-head CI is recorded externally after publication. The deterministic evaluation measured 0% false success for EvidenceForge versus 57.14% for an unenforced baseline. The strongest credentialed live workflow reached 9/10 application gates; `external-pr` remains the unverified live gate. The deterministic fixture completes the full approval/reconciliation/certificate path and is labeled accordingly.

## Problem

Agentic repair systems often collapse four different statements into one:

1. the model believes the task is fixed;
2. a tool returned something that looks successful;
3. deterministic checks passed on the current patch;
4. the external system now contains the intended result.

EvidenceForge treats these as separate states. Completion requires all of them to be proven with current, correctly bound evidence.

Symptom reproduction is also distinct from root-cause diagnosis. A failing exact command does not identify the defect that caused it.

## Design

### Application-owned success contract

The required criteria are created before work begins and cannot be removed by model prose. Each PASS must be supported by admissible evidence and a deterministic verifier result.

### Exact subject binding

Evidence is bound to task, repository, revision, patch digest, and scope. Repatching preserves incident facts but invalidates patch verification, review, approvals, actions, and operations.

### Causal diagnostic gate

Each named specialist must return a bounded structured object with a cause, causal mechanism, affected locations, and evidence references. Every reference must resolve to content from an earlier successful tool result in the same specialist thread; arbitrary strings and transport keys are rejected. EvidenceForge stores only the resolved event links as a non-authoritative `OPEN` observation. Only application-owned correlation with exact incident and reproduction evidence may promote the hypothesis to `SUPPORTED` and pass `root-cause-supported`.

### TrueForge orchestration

TrueForge remains the primary runtime. The supervisor uses exactly three named diagnostic specialists, Daytona for repository execution, a restricted/preloaded GitHub MCP surface, persistent sessions, streamed events, skills, and approval pauses.

### Serialized mutation and external effects

Diagnostics are read-only by contract. Patching is serialized. External PR creation requires an exact prepared action, a human approval bound to that action, and later authoritative reconciliation.

### Completion certificate

Only CompletionGate may issue the deeply immutable certificate accepted by the state machine. It binds the complete certified subject and includes canonical payload and subject digests.

## Reliability lessons from live operation

The live workflow exposed failures that fixture-only development would not have found:

- full checkpoint rewrites for thousands of model deltas caused timeout pressure;
- the historical failing revision lacked a lockfile and required its authoritative no-frozen install mode;
- the model proposed the wrong PR base and skipped the authoritative head read;
- tool discovery had to be removed from the supervisor surface;
- specialist tool budgets had to remain bounded and fail closed.

EvidenceForge blocked every unsafe deviation. No invalid PR was created.

## Qodo impact

Qodo Agentic Review materially improved certificate immutability, repatch invalidation, approval races, PR identity, cursor recovery, stream timeout fencing, event-journal order, terminal durability, cancellation retry, response binding, prompt bounds, and causal root-cause verification.

The fabricated-root-cause and unresolved-reference High paths are fixed in the candidate: exact context plus exact reproduction alone remains pending, and structured specialist causality is accepted only after same-thread tool-result resolution and application correlation. Exact-SHA Qodo confirmation remains an external gate.

Qodo's standing SDK-boundary High is valid but blocked: TrueForge SDK `0.1.3` has no per-dynamic-subagent pre-execution tool interceptor/allowlist. EvidenceForge does not mislabel post-event rejection as prevention.

## UI and judge-visible behavior

The console distinguishes:

- model activity;
- authoritative tool evidence;
- application-owned PASS;
- pending human approval;
- BLOCKED/FAILED/ESCALATED;
- certified COMPLETED.

Responsive browser observations cover 320, 375, 768, 1024, and 1440px. The final pass also raises muted small-text contrast and locks it with a deterministic >=4.5:1 test. Exact 200% browser zoom remains manual.

## Measured result

```text
Executable local candidate:  complete matrix, 233/233 tests
Deterministic fixture:       10/10 + CompletionGate certificate
Credentialed live workflow:  9/10; external-pr not completed
False-success evaluation:    EvidenceForge 0%; baseline 57.14%
PR state:                     open, unmerged, base determination
```

The exact final-head CI result for the commit containing this report is recorded externally in PR #2 after publication.

## Remaining risks and actions

- per-dynamic-subagent pre-execution capability isolation requires a future TrueForge SDK surface or a TrueForge-compatible read-only proxy;
- live external PR approval/write/reconciliation has not been stably reproduced;
- exact final-head CI/Qodo must be observed after this report commit;
- exact 200% zoom remains manual;
- video, human merge, and submission require human/external account actions.

## Submission position

EvidenceForge should be presented as a production-quality, fail-closed control plane with substantial credentialed live evidence and a transparent 9/10 boundary—not as a falsely completed end-to-end live run. The fixture may demonstrate the certificate path only when visibly labeled deterministic.
