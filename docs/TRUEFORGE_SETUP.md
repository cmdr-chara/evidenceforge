# TrueForge setup

## Requirements

- Node.js `>=22.14.0`
- A current TrueForge deployment
- A configured model provider
- GitHub personal access token suitable for the GitHub MCP server
- Daytona credentials

## Start TrueForge locally

Follow the official quickstart. The current documented command is:

```bash
npx @truefoundry/trueforge@latest
```

Keep local mode on localhost. For shared deployments, use TrueForge's hosted mode.

## Configure resources

In TrueForge settings:

1. Add a model and note its fully qualified name.
2. Add the shipped `github` MCP preset and provide the authorization header inside TrueForge.
3. Configure the Daytona sandbox provider.
4. Add each git-backed skill from this repository:
   - `incident-triage`
   - `ci-reproduction`
   - `verified-remediation`
   - `patch-review`

Do not put credentials in the agent instructions or repository.

## EvidenceForge environment

```bash
cp .env.example .env
export TRUEFORGE_BASE_URL=http://localhost:8790
export TRUEFORGE_MODEL=openai/gpt-5.2
export TRUEFORGE_GITHUB_MCP_NAME=github
export EVIDENCEFORGE_DATA_DIR=.data
# export TRUEFORGE_TOKEN=...  # only when OIDC is enabled
```

`EVIDENCEFORGE_DATA_DIR` controls the durable checkpoint and runtime-event directory. Blank or unset values default to `.data/`.

## Validate

```bash
pnpm doctor
pnpm smoke:trueforge
```

A successful smoke must show an actual TrueForge session and turn. It should report availability of GitHub MCP, Daytona, the four skills, subagents, and approvals without performing an external write.

## Live incident

Start the EvidenceForge console:

```bash
pnpm dev
```

Use the live form with `owner/repository`, GitHub Actions run ID, and exact failing commit SHA. The session state persists under `EVIDENCEFORGE_DATA_DIR` (default `.data/`) and includes TrueForge session, turn, and sequence IDs for resume.

Before any deterministic verifier runs, EvidenceForge gives the supervisor one exact, application-owned Daytona bootstrap manifest. It checks out the requested revision into `/workspace/repository`, installs the same pinned Node.js `22.14.0` and pnpm `11.16.0` toolchain used by CI (including a fixed Node archive checksum), and runs `pnpm install --frozen-lockfile`. A non-zero bootstrap exit is infrastructure evidence only and blocks verification; it can never satisfy a success criterion.

After the serialized edit and before any post-patch verifier, the supervisor must run the exact application-owned `evidenceforge.patch` manifest (`git diff --binary` in `/workspace/repository`). After all deterministic checks pass, it creates exactly one read-only `Independent Patch Reviewer`; EvidenceForge accepts only strict JSON bound to that patch digest with no critical blockers. GitHub calls may arrive through TrueForge's `call_tool` system envelope and are credited only when the inner MCP server, tool, and input are structurally valid.

Set the Daytona provider's default command timeout to at least `300000` ms. TrueForge 0.1.4 does not expose a per-call timeout field on the model-facing `sandbox.exec` schema, so the provider default must cover the longest immutable verifier (`pnpm test`, 300 seconds). EvidenceForge still records and validates the verifier manifest's application-owned timeout.

The live supervisor is restricted to EvidenceForge's GitHub operation allowlist: `get_commit`, `get_file_contents`, `issue_read`, `list_issues`, `list_pull_requests`, `search_issues`, `search_pull_requests`, and read-only `pull_request_read`; `create_pull_request` becomes admissible only after application approval. Any other operation, including `search_commits`, blocks the run.

## Approval behavior

The inline agent spec configures GitHub tool approval for `@write` and `@destructive`. EvidenceForge also applies its own risk policy. The PR action must be prepared in exact form and approved before the TrueForge `user.tool_approval` resume event is submitted.

## Troubleshooting

| Symptom | Action |
|---|---|
| SDK package cannot load | run `pnpm install` |
| health check fails | verify `TRUEFORGE_BASE_URL` and server process |
| model call fails | verify provider credentials in TrueForge |
| GitHub MCP auth pause | complete MCP authorization, then resume with empty input as documented |
| sandbox unavailable | configure Daytona in TrueForge settings |
| a complete verifier stops at about 60 seconds | set the TrueForge Daytona provider command timeout to at least `300000` ms; do not shorten the verifier |
| sandbox reports `/usr/bin/bash: no such file or directory` | inspect the requested `cwd`; Daytona can return this message when `/workspace/repository` was not materialized. Start a new live task with the current EvidenceForge bootstrap manifest instead of resuming a terminal turn |
| bootstrap cannot install the pinned runtime | verify outbound access to `github.com`, `nodejs.org`, and the package registry from Daytona; do not substitute host execution |
| skills absent | add git-backed skills and keep sandbox enabled |
| no Qodo review | install Qodo GitHub integration and comment `/agentic_review` |
