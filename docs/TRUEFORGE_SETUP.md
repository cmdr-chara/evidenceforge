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
| skills absent | add git-backed skills and keep sandbox enabled |
| no Qodo review | install Qodo GitHub integration and comment `/agentic_review` |
