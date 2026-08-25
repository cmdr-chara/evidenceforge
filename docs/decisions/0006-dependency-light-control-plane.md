# ADR 0006: Dependency-light deterministic control plane

- Status: Accepted
- Date: 2026-08-25

## Context

The initial execution environment could not resolve external npm or GitHub hosts. The project still needed honest local compilation and tests without substituting mock sponsor results.

## Decision

Implement the deterministic core with TypeScript and Node standard-library APIs. Use explicit runtime validation rather than adding a schema dependency solely for style. Keep the live TrueForge SDK as the only runtime dependency and load it behind an adapter.

## Consequences

- Core tests run without network installation in constrained environments.
- Runtime validation code is visible and auditable.
- The project forgoes some convenience and ecosystem validation helpers.
- A future migration to Zod is possible if it improves maintainability without weakening the boundary.

## Alternatives rejected

- Block all work until npm access exists: leaves independent P0 work undone.
- Vendor or fabricate packages: supply-chain and provenance risk.
- Stub the TrueForge package and claim integration: dishonest sponsor evidence.
