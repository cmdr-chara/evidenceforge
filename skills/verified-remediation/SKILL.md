---
name: verified-remediation
description: Produce a minimal serialized patch and verify it with deterministic repository-aware oracles.
license: MIT
---

# Verified remediation

Use this skill during `PATCHING`, `VERIFYING`, `RETRYING`, and `REPLANNING`.

## Procedure

1. Aggregate the three read-only diagnostic results before mutation.
2. Serialize all workspace mutation in the main thread.
3. Prefer the smallest patch that addresses the supported root cause.
4. Establish or add a regression verifier before relying on broad suites.
5. Run, in order where applicable: regression verifier, targeted tests, typecheck, lint/static checks, build, and `git diff --check`.
6. Correlate each verifier with its real TrueForge/Daytona runtime event.
7. Store oversized output as artifacts and keep only bounded previews in context.
8. Calculate the final patch digest after all edits.

## Failure behavior

- A valid command that still fails is a semantic failure. Reconsider the hypothesis or patch; do not blindly repeat it.
- Automatic retries are bounded.
- If correctness cannot be established after the budget, return `ESCALATED` rather than manufacturing success.
- Never remove or weaken a required success criterion silently.

## Output

Return changed files, concise diff summary, patch digest, verifier results, evidence IDs, remaining warnings, and whether replanning is required.
