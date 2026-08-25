# ADR 0005: Deterministic verifiers over model confidence

- Status: Accepted
- Date: 2026-08-25

## Context

Tests, typechecks, linters, failure signatures, and external-state reads produce stronger task-specific evidence than model confidence. Review models remain useful for dimensions without complete deterministic oracles.

## Decision

Deterministic verifier results are authoritative. A deterministic FAIL blocks completion even when the independent reviewer says PASS. Reviewer evidence may block but may not override deterministic failure.

## Consequences

- Control behavior is predictable and testable.
- Verifier/runtime event correlation is mandatory.
- Repositories need task-aware contracts instead of one universal command list.
- Reviews remain useful for maintainability, risk, and unsupported assumptions.

## Alternatives rejected

- Majority vote among models: multiple opinions are not an oracle.
- Reviewer override: permits false success after observed test failure.
- Run every check in every repository: creates irrelevant failures and weak contracts.
