# TrueForge setup

This guide separates normal repository verification from the exact historical live-incident profile.

## Supported profile

- TrueForge server observed: `0.1.4`
- SDK dependency: `@truefoundry/trueforge-sdk` `0.1.3`
- TrueForge URL: `http://localhost:8790`
- EvidenceForge live console: normally `http://127.0.0.1:4174`
- Model used in the profiled environment: `sub2api-codex/gpt-5-6-luna`
- Context: provider default `256k`
- Reasoning effort: `high`
- Maximum output: `4096`
- Live timeout: `1200` seconds
- Daytona provider command timeout: `300000` ms
- GitHub MCP server name: `github`

Keep credentials in TrueForge or local environment configuration. Never put API keys in repository files, prompts, logs, screenshots, or sandbox commands.

## Normal repository installation

The current repository contains a lockfile. Normal development and CI must remain frozen:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm eval:smoke
pnpm demo:fixture
pnpm build
pnpm doctor
```

## TrueForge resources

Configure:

1. the model provider;
2. the shipped `github` MCP server;
3. a Daytona sandbox provider;
4. the four git-backed skills:
   - `incident-triage`;
   - `ci-reproduction`;
   - `verified-remediation`;
   - `patch-review`.

Example environment:

```bash
export TRUEFORGE_BASE_URL=http://localhost:8790
export TRUEFORGE_MODEL=sub2api-codex/gpt-5-6-luna
export TRUEFORGE_GITHUB_MCP_NAME=github
export TRUEFORGE_TIMEOUT_SECONDS=1200
export EVIDENCEFORGE_PORT=4174
export EVIDENCEFORGE_DATA_DIR=.data
```

`.data/` and `.evidenceforge/` are runtime state and must remain ignored and untracked.

## Profiled live incident

EvidenceForge currently accepts the public profiled tuple:

```text
repository: cmdr-chara/evidenceforge
run:        32892119950
revision:   9accc9e484e055c8b22172e389dc50f84315f4e2
baseline:   pnpm test:unit
failure:    authoritative TrueForge sandbox non-zero exit is never reported as OK
```

An unprofiled repository/run/revision tuple is rejected before TrueForge starts.

### Historical bootstrap exception

The profiled historical revision does **not** contain `pnpm-lock.yaml`. Its authoritative CI installed dependencies with:

```bash
pnpm install --no-frozen-lockfile
```

The application-owned live bootstrap mirrors that install mode while pinning Node `22.14.0` and pnpm `11.16.0`. Do not restore `--frozen-lockfile` inside this historical profile unless truthful revision-bound lockfile evidence is also supplied. This exception does not apply to normal repository CI.

The bootstrap must finish successfully before any verifier. A bootstrap failure is infrastructure evidence and can never satisfy `failure-reproduced`.

## Application-owned sequencing

The live workflow is intentionally narrow:

1. Read the exact incident revision with one authoritative GitHub `get_commit` call.
2. Bootstrap the exact revision in Daytona.
3. Run exactly three named read-only diagnostics in one fan-out:
   - Repository Investigator;
   - Failure / Log Investigator;
   - Dependency / Configuration Investigator.
4. Require each specialist to return one bounded JSON object containing observations, causal hypotheses, affected locations, and exact strings observed in that specialist's completed tool results.
5. Resolve every causal reference to an earlier successful `TOOL_RESULT` from the same specialist thread; model-authored locations and reference strings never become artifact references directly.
6. Store only those event-backed causal claims as non-authoritative `OPEN` observations.
7. Reproduce the original failure using the application-owned manifest.
8. Promote `root-cause-supported` only when the application correlates a current event-backed observation with admissible exact-incident and exact-reproduction evidence.
9. Serialize patching.
10. Capture `git diff --binary` before any post-patch verifier.
11. Run every deterministic verifier from the exact manifest.
12. Run one isolated independent reviewer bound to the current patch digest.
13. Read the authoritative current branch head with `get_commit`.
14. Prepare one exact PR action targeting `feat/foundation-control-plane` → `determination`.
15. Pause before `create_pull_request` for human approval.
16. After an approved write, reconcile through `pull_request_read`.
17. Allow only `CompletionGate` to issue completion.

Context plus reproduction is not a root cause. A missing causal mechanism, an empty evidence reference set, a wrong base such as `main`, a missing head read, an unbound patch, a specialist budget violation, or a resumed terminal task blocks or remains pending before external effects.

## GitHub MCP surface

The supervisor preloads exactly:

- `get_commit`;
- `create_pull_request`;
- `pull_request_read`.

Tool discovery and unrelated GitHub operations are not exposed to the supervisor. `create_pull_request` remains approval-paused. EvidenceForge validates official MCP fields separately from application-owned operation identity, approval provenance, expected head SHA, and patch binding.

## Human approval and reconciliation

Approval is not a prompt instruction. It is durable application state bound to:

- exact normalized arguments;
- operation and idempotency identity;
- repository and revision;
- current patch/external subject;
- risk classification;
- expiry;
- one-time consumption.

No write occurs before approval. A create response is only a receipt; it does not satisfy `external-pr`. The application must perform an authoritative PR read and match repository, base, head, head SHA, operation, and idempotency identity.

## Continuation

A completed TrueForge turn may continue in the same session for one new turn only when the latest durable event is `TURN_DONE`, every non-external criterion and the current reviewer are PASS, `external-pr` remains PENDING, and there is no terminal state, pending approval, or prepared action.

A BLOCKED, FAILED, ESCALATED, stale, or already-prepared task must never be resumed as ACTIVE.

## Stream durability

Model deltas are journaled and projected for correlation, but they do not trigger a full checkpoint for every fragment. Full state/evidence checkpoints occur at semantic events and turn boundaries. Accepted event commits are serialized, late callbacks are fenced, terminal persistence is explicit, and a persistence failure cannot be reported as a durable BLOCKED state.

## SDK limitation

TrueForge SDK `0.1.3` does not expose a per-dynamic-subagent pre-execution tool allowlist or interceptor. EvidenceForge enforces exactly-three topology, named roles, bounded tool budgets, read-only contracts, serialized mutation, and fail-closed post-event validation, but it does not claim pre-execution prevention that the SDK cannot provide.

## Start and validate

```bash
pnpm doctor
pnpm smoke:trueforge
pnpm dev
```

A successful smoke proves connectivity only. It is not a substitute for the profiled incident workflow.

## Observed live result

The strongest credentialed run reached 9/10 application gates: incident context, failure reproduction, root cause, regression, targeted tests, typecheck, lint, diff integrity, and independent review all passed. `external-pr` remained pending/blocked. No invalid PR write or merge occurred.

The deterministic fixture can complete the approval/reconciliation/certificate path, but must remain labeled fixture evidence.

## Troubleshooting

| Symptom | Required response |
|---|---|
| repository install rejects lockfile drift | keep normal CI frozen; inspect the committed lockfile |
| historical live bootstrap reports no lockfile | use the profile's `--no-frozen-lockfile` manifest; do not change normal CI |
| verifier stops near 60 seconds | set Daytona provider command timeout to at least `300000` ms |
| specialist returns prose or symptom-only “cause” | reject/block; require the bounded causal JSON contract |
| model proposes `base: main` | block; the exact base is `determination` |
| model skips head `get_commit` | block before any write |
| specialist exceeds tool budget | block; do not silently continue |
| `list_tools` appears | verify the three-tool preloaded supervisor MCP configuration |
| pending approval exists | obtain an explicit human decision; never approve automatically |
| terminal task is offered for resume | reject the continuation |
| credentialed services are unavailable | label the live gate UNVERIFIED; do not substitute fixture output |
