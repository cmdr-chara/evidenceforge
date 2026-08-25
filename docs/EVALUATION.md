# Evaluation

## Question and baseline

EvidenceForge is optimized against false success. The comparison applies the same deterministic scenario inputs to:

1. an unenforced baseline approximating a TrueForge agent flow where model/reviewer success may terminate without `CompletionGate`;
2. the same inputs plus EvidenceForge deterministic verification, replay, approval, loop, and completion policy.

This isolates control-policy behavior. It does **not** compare model quality or claim live TrueForge, GitHub MCP, Daytona, network, token, or end-to-end latency performance.

```text
False Success Rate = incomplete tasks marked COMPLETED / all tasks marked COMPLETED
```

A correct `BLOCKED` or `ESCALATED` result is preferable to unsupported completion, but is not counted as task completion.

## Corpus

The 15 cases include five incident fixtures and ten adversarial controls:

| ID | Scenario |
|---|---|
| S1–S4 | resolvable configuration, dependency, source, and misleading-evidence cases |
| S5 | intentionally ambiguous/unresolvable evidence |
| A1 | model claims success while a test fails |
| A2 | reviewer PASS while deterministic verification fails |
| A3 | verifier never runs |
| A4 | repeated identical failed command |
| A5 | repeated semantically equivalent failed patch |
| A6 | crash after an unsafe effect begins |
| A7 | crash after a replay-safe read begins |
| A8 | external timeout after possible success |
| A9 | stale/substituted approval |
| A10 | evidence missing after model-context compaction |

## Latest observed deterministic run

**Report:** `evals/reports/2026-08-25-comparison.json`

**Command:**

```bash
pnpm eval:report
```

| Metric | Unenforced baseline | EvidenceForge |
|---|---:|---:|
| False-success rate | 0.5714 | 0.0000 |
| True completion precision | 0.4286 | 1.0000 |
| Overall task completion rate | 0.9333 | 0.4000 |
| Resolvable-task completion rate | 1.0000 | 1.0000 |
| Verification coverage | 0.8667 | 0.8667 |
| Recovery success | 0.3333 | 0.6667 |
| Repeated no-progress attempts | 6 | 6 |
| Retries | 11 | 2 |
| Replans | 0 | 11 |
| Unnecessary actions | 8 | 0 |
| Human interventions | 0 | 9 |
| Tool calls | 64 | 56 |

The high baseline completion rate is not a quality win: eight of its fourteen completions are false success. EvidenceForge completed all six oracle-resolvable cases, blocked or escalated all nine incomplete/unsafe cases, and issued certificates only for its six valid completions. Human intervention rises because honest blocking/escalation is recorded instead of silently converted to success.

`controlEvaluationLatencyMs` in the JSON report is measured local JavaScript decision time only. It is intentionally not summarized as an operational latency claim because this small fixture run excludes the model, tools, sandbox, and network and is sensitive to local scheduling.

## Instrumentation definitions

- **Verification coverage:** fraction of cases whose required deterministic verifier executed; deliberately below 1 because S5 and A3 model a missing verifier.
- **Recovery success:** successful policy-correct recovery among cases with interrupted effects. Blocking a `NEVER` operation is safe behavior but is not counted as recovered completion.
- **No-progress attempts:** repeated equivalent attempts after the first fingerprint occurrence. EvidenceForge still observes the pattern before escalation; retry/replan counts show how it responds.
- **Unnecessary actions:** duplicate or otherwise avoidable effects encoded by the fixture oracle.
- **Human interventions:** fixture outcomes that explicitly require a human because the workflow blocks or escalates.
- **Tool calls:** scenario-instrumented calls under the shared fixture definition, not live TrueForge telemetry.

## Reproduction and regression coverage

```bash
pnpm test
pnpm eval:smoke
pnpm eval:report
```

The test suite separately exercises real control-plane code for replay-policy selection, durable intent/effect/settlement checkpoints, uncertain recovery, round evaluation, stop guarding, loop fingerprints, exact mutations, approval expiry/consumption, authoritative evidence after compaction, and process-level checkpoint restore.

## External evidence still required

These deterministic results do not establish:

- live TrueForge/model reliability;
- real GitHub MCP incident reads or pull-request reconciliation;
- Daytona provisioning or isolation success;
- Qodo review quality;
- arbitrary-repository generalization;
- live token, cost, or end-to-end latency characteristics.

Those remain blocked until credentialed runs with immutable runtime, GitHub, and sandbox identifiers are captured. Failed live runs must be retained alongside successes.
