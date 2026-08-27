# Recovered unpublished P0/P1/P2 work

This directory preserves the exact GitHub blob objects recovered from the interrupted coordinated EvidenceForge run on 2026-08-27.

Base branch/head when recovered:
- branch: `feat/foundation-control-plane`
- base commit: `886025900ad918db88419c081adc068cafb0e7a7`
- base tree: `7c0e075b78a216c36cd34a94bb4f79cd9bb1583c`

The files in `snapshots/` are **not active source files**. They are exact recovered candidate contents, stored under recovery paths so they remain reachable by Git without changing runtime behavior or pretending the interrupted batch passed verification.

Recovered target mapping:

| Recovery snapshot | Intended target | Original blob SHA |
| --- | --- | --- |
| `snapshots/completion-subject.ts.txt` | `packages/verification/src/completion-subject.ts` | `b41a04cee97d7c92412c9fa8f79e5039646808f6` |
| `snapshots/evidence-factory.ts.txt` | `packages/evidence/src/factory.ts` | `6321505eb989d8ced6f51408954e29a3a3666925` |
| `snapshots/evidence-store.ts.txt` | `packages/evidence/src/store.ts` | `02ede8708d9b2da9fe72c27dc37c95c5014a807f` |
| `snapshots/verification-engine.ts.txt` | `packages/verification/src/engine.ts` | `4c72e1a5a997ef41fd4c3b263b9d740dfec72e9a` |
| `snapshots/progress-evaluator.ts.txt` | `packages/verification/src/progress-evaluator.ts` | `8af93418cd98423b8822a54a9f8e59e156e311dd` |
| `snapshots/completion-gate.ts.txt` | `packages/verification/src/completion-gate.ts` | `bf447d4e7d276fe3aac1ad5de2d4000073c29a59` |
| `snapshots/state-machine.ts.txt` | `packages/workflow/src/state-machine.ts` | `265548832dd1e268c50efce2280d366f6bcf7661` |
| `snapshots/external-action.ts.txt` | `packages/policies/src/external-action.ts` | `f5a422da989dbde804b4d53b510045d4603501ea` |
| `apply-domain-scope.mjs.txt` | deterministic transform for `types.ts`, `factories.ts`, `validation.ts`, and `success-contract.ts` | `4c8f8985859b74d0f81d2fa8307dcc96f23a54d3` |

Important limitations:
- one direct domain-types blob creation was blocked during the interrupted run, so the exact final domain file snapshot was not recoverable;
- the deterministic transform script that generated those domain/success-contract edits was recovered and is preserved here;
- no claim is made that this WIP passes format, lint, typecheck, tests, CI, Qodo, or live TrueForge gates;
- no `.evidenceforge/` runtime state is included;
- this recovery commit must not be treated as a completion certificate or release candidate.

Resume procedure:
1. start from the branch head containing this recovery bundle;
2. reconstruct a clean worktree from the active source files;
3. copy each snapshot to its intended target and apply `apply-domain-scope.mjs.txt` as a reviewed transform;
4. reconcile against any newer remote commits before writing;
5. run all mandatory local gates before publishing functional source changes;
6. keep PR #2 open and unmerged until exact-SHA CI/Qodo/live gates are truthfully satisfied.
