# Build journal

This journal records observed work and failures. It intentionally omits invented sponsor runs and private reasoning.

## 2026-08-25 — repository and requirements

### Observed

- `cmdr-chara/evidenceforge` was public and genuinely empty.
- Default branch was `determination`.
- GitHub returned no commit history.
- Created the smallest bootstrap commit containing only `README.md`.
- Created `feat/foundation-control-plane` and issue #1 for the P0 build.

### Requirements learned

- Current rules require every substantive change to use a Qodo-reviewed PR.
- Qodo High findings must be fixed or explicitly dismissed, followed by review evidence.
- TrueForge currently documents Node `>=22.14`, SDK `@truefoundry/trueforge-sdk`, Daytona sandboxing, git-backed skills, dynamic subagents, write approvals, persistent sessions, compaction, and large-result offloading.
- TrueForge subagents share a sandbox and do not nest; parallel mutation is therefore unsafe.
- MCP annotations are not a trusted authorization source by themselves.

### Failure

The local execution container could not resolve external GitHub or npm hosts. A direct `git clone` and dependency installation were unavailable.

### Adaptation

- Used the authenticated GitHub connector for repository inspection and writes.
- Kept the deterministic core dependency-light.
- Used the preinstalled Node 22 and TypeScript toolchain for local compilation.
- Isolated the live TrueForge SDK behind a dynamically loaded adapter so deterministic tests do not pretend the sponsor runtime exists.

## 2026-08-25 — deterministic control plane

### Implemented

- domain schemas and runtime validation;
- evidence store with event correlation;
- verifier engine;
- certificate-only CompletionGate;
- explicit state machine;
- success contract;
- hypothesis ledger;
- trusted risk overlay;
- approval and external-action protocol;
- bounded recovery budgets;
- exactly three read-only diagnostic specialists;
- isolated reviewer definition;
- bounded log/repository/sandbox tool contracts;
- JSON persistence and event journal.

### Verification

Initial run: 54 tests passed.

After adding the incident console and approval flow: 58 EvidenceForge tests passed plus 3 healthy demo-fixture tests.

### Issues found during development

- The first UI server smoke command backgrounded compilation and server startup together, so the curl ran before the server existed. The command was corrected to compile synchronously before starting the process.
- A static lint assertion counted a TypeScript union declaration as a fourth specialist. The check was corrected to count the three concrete specialist names.
- The first evaluation implementation incorrectly counted the intentionally escalated case as reproduced. The metric was corrected; reproduction rate is 0.80, not 1.00.

These corrections are retained because they demonstrate that the evaluation and tooling are not being optimized to produce prettier numbers.

## 2026-08-25 — TrueForge integration and console

### Implemented

- current snake_case inline TrueForge agent spec;
- GitHub MCP attachment with write/destructive approvals;
- Daytona sandbox enabled;
- four skills attached;
- dynamic subagents, compaction, large-result handling, and iteration limit;
- SDK stream normalization;
- approval resume inputs;
- durable reconnect using session, turn, and sequence IDs;
- incident console with phase, contract, specialists, hypotheses, evidence, patch, approval, and certificate panels;
- deterministic fixture mode clearly labeled;
- live start/resume API that fails closed without infrastructure.

### Verified

- HTTP health endpoint returned `ok`.
- Console HTML served successfully.
- Fixture state exposed 10 criteria and 3 specialists.
- API progression paused at `AWAITING_APPROVAL`.
- Approval advanced to `PUBLISHING`.
- Reconciliation produced `COMPLETED`, 10/10 criteria, and fixture PR `#219`.
- Denial path is covered by an integration test and produces `BLOCKED` without a certificate.

### External blockers

No TrueForge server, model credential, GitHub MCP credential, Daytona credential, or Qodo installation was available to this execution environment. Live integration remains unverified.

## Next highest-risk work

1. Push the substantive branch and open the first PR.
2. Trigger real Qodo Agentic Review and act on findings.
3. Configure TrueForge, GitHub MCP, Daytona, and a model.
4. Run the live smoke and preserve session/trace evidence.
5. Seed the red demo branch, resolve it through EvidenceForge, approve a real PR, and reconcile it.
6. Record the short demo and update submission links.

## 2026-08-25 — fixture reset and blocked live smoke

### Verified

- Seeding the fixture made the test command exit 1 with the stable `CONFIG_VALIDATION_ORDER` signature.
- Resetting restored the healthy fixture; all 3 fixture tests passed.
- The EvidenceForge suite now passes 58 / 58 tests.
- The latest JSON evaluation report is committed under `evals/reports/`.

### Honest blocked checks

`node scripts/doctor.mjs` passed the Node, package-manager, and SDK-version checks, then reported missing TrueForge URL, model configuration, and installed dependencies. `node scripts/trueforge-smoke.mjs` failed closed because no TrueForge server was reachable. No live sponsor result was inferred from the adapter tests.

## 2026-08-25 — first pull request CI diagnosis

### Observed

- PR #2 was open at commit `3aaed3c09d5d7571a5aedf235a0520f1d302dcc8`.
- GitHub Actions run `32887542016` failed before installation or tests.
- The failure occurred in `actions/setup-node@v4` because `cache: pnpm` was evaluated before a `pnpm` executable existed on `PATH`.
- Qodo had been invoked with `/agentic_review`, but no Qodo review or finding was present yet.

### Correction

- Added `pnpm/action-setup@v4` before `actions/setup-node@v4`.
- Pinned the action to the repository's declared pnpm version `11.16.0`.
- Retained pnpm dependency caching and removed the now-redundant `corepack enable` CI step.

### Verification

- Local typecheck, lint, format checks, 58 tests, 3 fixture tests, and the five-case smoke evaluation still pass.
- Remote CI status is pending the corrective commit; no green result is claimed until observed.
