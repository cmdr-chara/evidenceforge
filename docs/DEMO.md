# Demo script

Target length: 3–5 minutes.

## Before recording

1. Run all checks.
2. Reset the healthy fixture.
3. Prepare and push the dedicated failing demo branch only after approving that external write.
4. Confirm the GitHub Actions run is red and record its immutable run ID and commit SHA.
5. Confirm TrueForge, GitHub MCP, Daytona, skills, model, and Qodo connections.
6. Open the EvidenceForge console and clear stale local session data only when a fresh demo is intended.

```bash
pnpm demo:reset
pnpm lint
pnpm typecheck
pnpm test
pnpm eval:smoke
pnpm demo:fixture
pnpm dev
```

## Deterministic rehearsal

The default console is labeled `DETERMINISTIC FIXTURE`. It exercises the real EvidenceForge state machine, evidence store, policy, and CompletionGate without claiming live sponsor calls.

Use **Advance evidence** eight times to reach approval. Reject once during rehearsal to show safe blocking; reset, then repeat and approve to show certificate issuance.

## Live demo

### 0:00–0:25 — real failure

Show the red GitHub Actions run on `demo/config-order-regression`.

Point out:

- repository and workflow;
- failing revision;
- failed job;
- stable `CONFIG_VALIDATION_ORDER` signature.

Start EvidenceForge with the actual repository, run ID, and commit SHA.

### 0:25–0:50 — success contract

Show the locked criteria:

```text
○ authoritative incident context
○ original failure reproduced
○ supported root cause
○ regression verifier
○ targeted tests
○ typecheck
○ lint
○ diff integrity
○ independent review
○ reconciled pull request
```

State that the model cannot remove a criterion after a failed check.

### 0:50–1:30 — parallel diagnostics

Show TrueForge spawning exactly:

```text
Repository Investigator
Failure / Log Investigator
Dependency / Configuration Investigator
```

Show the read-only badges and the hypothesis ledger:

```text
H1 missing CI secret          REFUTED
H2 dependency regression      REFUTED
H3 validation-order regression SUPPORTED
```

Explain that the subagents share the sandbox, so mutation is forbidden during fan-out.

### 1:30–2:00 — Daytona reproduction

Show the sandbox command event:

```text
node --test demo/incident-fixture/test/config.test.mjs
exit 1
CONFIG_VALIDATION_ORDER matched
```

Show the `REPRODUCTION` evidence ID and exact revision.

### 2:00–2:40 — patch and deterministic verification

Show the minimal diff: apply test fallback before production validation.

Then show actual runtime events for:

- regression verifier PASS;
- targeted suite PASS;
- typecheck PASS;
- lint PASS;
- `git diff --check` PASS.

A sentence such as “tests passed” is not evidence; the Daytona command events are.

### 2:40–3:05 — independent review

Show the isolated reviewer inputs and verdict:

```text
critical issues: 0
verdict: PASS
```

State that reviewer PASS cannot override a deterministic FAIL.

### 3:05–3:35 — human approval

Show TrueForge paused before the GitHub write.

The approval card must display:

- repository;
- base and head branches;
- title and body;
- expected head SHA;
- risk `EXTERNAL_REVERSIBLE`;
- reversibility;
- Reject and Approve.

Approve the exact action.

### 3:35–4:00 — proof

Show:

1. the real GitHub pull request;
2. reconciliation confirming the expected head SHA;
3. `EXTERNAL_RESULT` evidence;
4. the completion certificate with task, criteria, patch digest, reviewer, PR, and trace ID.

## Persistence moment

Refresh the browser after reproduction or while approval is pending. The UI should reload the same task and TrueForge cursor rather than restarting investigation.

## Reset/reseed

Restore the healthy default-branch fixture:

```bash
pnpm demo:reset
pnpm demo:fixture
```

Prepare a local failure branch:

```bash
node demo/incident-fixture/scripts/reseed-demo-branch.mjs
```

Pushing is an external write and is not automatic:

```bash
node demo/incident-fixture/scripts/reseed-demo-branch.mjs --push
```

Review the exact branch and command before using `--push`.

## Fallback evidence

When allowed by the rules, retain a pre-recorded run only as a fallback. Do not present a fixture or recording as a live sponsor run. Preserve run IDs, commit SHAs, PR links, and TrueForge trace IDs in the submission notes.
