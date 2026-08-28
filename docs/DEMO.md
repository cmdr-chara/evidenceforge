# Demo script

Target: approximately three minutes. The demo must distinguish credentialed live evidence from deterministic fixture evidence at all times.

## Before recording

1. Confirm PR #2 is open, unmerged, and targets `determination`.
2. Confirm the exact final SHA and CI run in the PR body.
3. Confirm TrueForge, model, GitHub MCP, Daytona, and skills are available.
4. Run the repository checks.
5. Reset the deterministic fixture.
6. Decide whether the live section will stop at 9/10 or proceed to a genuine human-approved external write. Never approve automatically.

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm eval:smoke
pnpm demo:reset
pnpm demo:fixture
pnpm build
pnpm doctor
pnpm dev
```

`pnpm demo:reset` restores the known healthy fixture before validation or recording. `pnpm demo:fixture` tests that restored state; it does not reset files itself.

## 0:00–0:20 — the promise

Show the EvidenceForge console and state:

> The model can propose that a task is fixed. Only the application can certify completion.

Point out the visible distinction between model activity, authoritative tool evidence, application PASS, approval, BLOCKED, and certified COMPLETED.

## 0:20–1:45 — credentialed live path

Use the profiled incident:

```text
repository: cmdr-chara/evidenceforge
run:        32892119950
revision:   9accc9e484e055c8b22172e389dc50f84315f4e2
failure:    authoritative TrueForge sandbox non-zero exit is never reported as OK
```

Show, as actually observed:

1. exact GitHub `get_commit` incident context;
2. Daytona bootstrap of the exact historical revision;
3. exactly three named diagnostic specialists;
4. bounded structured causal claims from diagnostics;
5. failure reproduction;
6. application correlation of exact incident, reproduction, and causal evidence;
7. serialized patch and patch digest;
8. deterministic regression/tests/typecheck/lint/diff checks;
9. independent reviewer bound to the current patch.

The strongest existing live evidence reaches 9/10. When `external-pr` is not genuinely completed, stop and label the result **LIVE — 9/10 — NOT CERTIFIED**.

Show one fail-closed behavior if useful: wrong `base: main`, missing head `get_commit`, symptom-only root cause, or specialist budget violation. Make clear that no write occurred.

## 1:45–2:20 — approval boundary

Show the approval card or prepared action. It must display the exact repository, `head: feat/foundation-control-plane`, `base: determination`, expected head SHA, risk, and reversible status.

Do not click Approve unless the exact external write is intended and a human has reviewed it. A pending approval is a valid demonstration of control; it is not completion.

## 2:20–2:55 — deterministic certificate path

Reset to the visibly labeled deterministic fixture. Advance through approval simulation, exact reconciliation, and CompletionGate certificate issuance.

State explicitly:

> This fixture proves the application control plane. It is not credentialed TrueForge, GitHub MCP, or Daytona evidence.

Show the certificate's task, criteria, patch digest, reviewer, external identity, trace, and payload/subject binding.

## 2:55–3:00 — close

Show PR #2 and the deterministic evaluation:

```text
EvidenceForge false success: 0%
Unenforced baseline:          57.14%
```

Close with:

> EvidenceForge does not ask whether the agent sounds confident. It asks whether the evidence is admissible.

## Recording checklist

- [ ] No API keys, tokens, or private headers visible.
- [ ] Fixture and live modes visibly labeled.
- [ ] No unobserved sponsor result claimed.
- [ ] No automatic approval or merge.
- [ ] Exact SHA/CI/Qodo links included in submission notes.
- [ ] SDK read-only specialist limitation disclosed.
- [ ] Video URL added to the submission checklist after publication.
