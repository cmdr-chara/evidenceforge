---
name: ci-reproduction
description: Reproduce a CI failure at the exact revision inside the TrueForge Daytona sandbox and capture admissible evidence.
license: MIT
---

# CI reproduction

Use this skill during `REPRODUCING`.

## Procedure

1. Provision or resume the TrueForge Daytona sandbox.
2. Check out the exact failing revision and record the resolved commit SHA.
3. Preserve the baseline before mutation.
4. Install dependencies using the repository's declared package manager and lockfile.
5. Run the narrowest command likely to reproduce the authoritative failure.
6. Capture exit code, duration, bounded stdout/stderr previews, and artifact references for oversized output.
7. Compare the observed failure with the stable GitHub Actions signature.
8. Emit `REPRODUCTION` evidence only when the command actually fails in the expected way.

## Guardrails

- Never execute repository code on the host.
- Use explicit working directories, hard timeouts, and bounded output.
- Do not use `sudo` or broad host mounts.
- Keep model and MCP credentials outside the sandbox.
- A different failure is not a reproduction.
- A successful command is not proof that the original failure was reproduced.

## Output

Return the exact revision, command, exit code, signature comparison, artifact references, and the resulting evidence ID.
