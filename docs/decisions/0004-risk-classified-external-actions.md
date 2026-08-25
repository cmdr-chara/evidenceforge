# ADR 0004: Risk-classified external actions

- Status: Accepted
- Date: 2026-08-25

## Context

MCP tool annotations help discovery but are not a trusted authorization source. GitHub pull-request creation is a consequential external write and may be duplicated when a request times out after succeeding.

## Decision

Classify actions through an EvidenceForge-owned trusted registry. External reversible and unknown actions require human approval. Privileged and destructive actions are denied in P0. Pull-request creation follows `PREPARE → APPROVE → COMMIT → RECONCILE` with an idempotency key derived from session and patch digest.

## Consequences

- Repository content and MCP metadata cannot silently authorize a write.
- Approval arguments are explicit and reviewable.
- Timeout recovery reads external state before retrying.
- The P0 system intentionally avoids autonomous merge and deployment.

## Alternatives rejected

- Trust MCP annotations exclusively: annotations may be absent, incorrect, or attacker-controlled at the server boundary.
- Retry create-PR blindly: can duplicate side effects.
- Approve all writes at session start: hides the exact consequential action.
