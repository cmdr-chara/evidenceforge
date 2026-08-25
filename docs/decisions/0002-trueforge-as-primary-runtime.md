# ADR 0002: TrueForge as the primary runtime

- Status: Accepted
- Date: 2026-08-25

## Context

EvidenceForge needs model execution, MCP, sandboxing, approvals, subagents, persistent sessions, context management, and event streaming. Reimplementing those capabilities or adding a second orchestration framework would obscure sponsor usage and increase failure surface.

## Decision

Use TrueForge as the sole agent harness. EvidenceForge remains a domain-control layer around TrueForge events and APIs.

## Consequences

- Sponsor primitives are central and visible.
- The application can focus on incident semantics and deterministic control.
- Live operation depends on TrueForge, model, GitHub MCP, and Daytona configuration.
- The deterministic core remains testable without pretending the runtime is available.

## Alternatives rejected

- LangGraph or another primary orchestrator: duplicates the harness.
- Direct model and GitHub REST clients: hides TrueForge/MCP usage.
- Custom sandbox lifecycle: unnecessary and risky for the hackathon scope.
