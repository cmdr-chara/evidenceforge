# ADR 0003: Parallel read-only diagnostics

- Status: Accepted
- Date: 2026-08-25

## Context

Repository, failure-log, and dependency/configuration investigations are independent enough to run concurrently. TrueForge subagents have isolated contexts but share tools and the same sandbox.

## Decision

Run exactly three diagnostic specialists in parallel and make each explicitly read-only. Aggregate their results before any mutation. Reproduction and patching remain serialized in the main thread.

## Consequences

- Investigation latency and context bloat are reduced.
- Competing hypotheses receive partially independent evidence.
- Workspace races and ambiguous patch provenance are avoided.
- A timed-out specialist can be represented as a partial result rather than authorizing mutation.

## Alternatives rejected

- One monolithic investigator: higher context noise and less independent evidence.
- Parallel patch agents: shared-workspace races and unclear verification provenance.
- Nested manager swarms: TrueForge does not nest subagents and the complexity is unjustified.
