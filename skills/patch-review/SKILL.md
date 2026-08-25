---
name: patch-review
description: Independently review the final patch against its contract and evidence without receiving the patching transcript.
license: MIT
---

# Patch review

Use this skill during `REVIEWING` with a fresh, isolated context.

## Inputs

Receive only:

- task and constraints;
- versioned success contract;
- final diff;
- concise evidence summary;
- deterministic verifier results;
- changed-file summary.

Do not receive the entire patching transcript or private reasoning.

## Review dimensions

1. Correctness and whether the diff addresses the supported root cause.
2. Regression risk and missing edge cases.
3. Security and trust-boundary violations.
4. Maintainability and unnecessary complexity.
5. Overbroad or unrelated changes.
6. Unsupported assumptions or success claims.

## Verdicts

Return exactly one structured verdict:

- `PASS`
- `PASS_WITH_WARNINGS`
- `BLOCK`

Include critical findings, warnings, and evidence references. A reviewer verdict is supporting evidence only. It can block completion, but it can never override a deterministic failed verifier.
