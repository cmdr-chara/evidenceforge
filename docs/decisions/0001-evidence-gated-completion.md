# ADR 0001: Evidence-gated completion

- Status: Accepted
- Date: 2026-08-25

## Context

A model can generate a plausible patch and a plausible statement that the patch worked. Using those statements as completion authority creates circular validation and false-success risk.

## Decision

Only deterministic application logic may transition a task to `COMPLETED`. Every required success criterion must be `PASS` with admissible evidence tied to a registered runtime event. `CompletionGate` issues the only certificate accepted by the state machine.

## Consequences

- Unsupported model confidence cannot complete a task.
- Some tasks end `BLOCKED` or `ESCALATED` despite plausible fixes.
- Evidence and verifier schemas become first-class product concepts.
- The system requires more explicit failure handling than a chat agent.

## Alternatives rejected

- Model self-evaluation: circular and non-deterministic.
- Reviewer-only gate: still model-mediated and unable to override deterministic oracles safely.
- “All tools returned success” gate: tool success does not mean the task objective is satisfied.
