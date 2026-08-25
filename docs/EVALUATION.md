# Evaluation

## Objective

EvidenceForge is optimized against **false success**, not confident prose.

```text
False Success Rate =
completed tasks whose independent oracle says incomplete
--------------------------------------------------------
all tasks marked completed
```

A correct escalation is preferable to an unsupported completion.

## Evaluation corpus

| Case | Purpose | Expected |
|---|---|---|
| S1 | configuration-order regression | `COMPLETED` with certificate |
| S2 | dependency/config mismatch | identify non-source cause and complete |
| S3 | source regression | code fix plus regression verification |
| S4 | misleading evidence | reject plausible model-only claim, then complete on real evidence |
| S5 | intentionally ambiguous/unresolvable | `ESCALATED`, never false success |

## Latest observed local run

**Run timestamp:** 2026-08-25T18:29:10Z

Commands actually executed:

```bash
node scripts/run-tests.mjs
node scripts/run-eval.mjs
node --test demo/incident-fixture/test/*.test.mjs
```

Observed results:

- EvidenceForge tests: **58 passed, 0 failed**.
- Healthy demo fixture tests: **3 passed, 0 failed**.
- Evaluation cases: **5 executed**.
- Completed resolvable cases: **4 / 4**.
- Safe escalations: **1 / 1**.
- False-success completions: **0**.

| Metric | Observed |
|---|---:|
| False Success Rate | 0.00 |
| True completion precision | 1.00 |
| Task success rate on resolvable fixture cases | 1.00 |
| Failure reproduction rate | 0.80 |
| Required-criterion verification coverage | 0.80 |
| Escalation rate | 0.20 |

The 0.80 reproduction and verification rates are intentional: S5 has insufficient evidence and escalates without claiming reproduction or passing criteria.

## What these numbers do not mean

These are deterministic fixture results. They do **not** establish:

- live TrueForge reliability;
- live GitHub MCP correctness;
- Daytona provisioning success;
- Qodo review quality;
- performance across arbitrary repositories;
- general model accuracy.

Those claims remain blocked until real sponsor-infrastructure runs are captured.

## Failure-injection coverage

The suite covers:

| Failure | Expected behavior |
|---|---|
| GitHub 429 | bounded backoff, then escalation |
| GitHub 500 | bounded transient policy |
| malformed event | normalized without granting evidence |
| sandbox crash | recreate exact revision and restore known patch |
| specialist timeout | preserve partial results and identify missing specialist |
| incorrect hypothesis | refute only with evidence |
| patch still fails | semantic replan |
| approval denied | no publish; `BLOCKED` |
| oversized log | reject unbounded request |
| verifier never runs | completion impossible |
| reviewer PASS + test FAIL | deterministic failure wins |
| possible PR timeout after write | reconcile before retry |

## Reproduction

```bash
corepack enable
pnpm install --no-frozen-lockfile
pnpm test
pnpm eval:smoke
```

The evaluator emits JSON so future live case runs can be stored without manually editing results.

## Next evaluation work

1. Add real GitHub Actions runs with immutable run IDs and commit SHAs.
2. Add live Daytona reproduction records.
3. Measure tool calls, latency, token use, retries, and human interventions from TrueForge events.
4. Compare at least one model configuration without changing the deterministic gate.
5. Preserve all failed runs, not only successful demonstrations.
