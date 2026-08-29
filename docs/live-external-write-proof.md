# Credentialed live external-write proof

**Observed:** 2026-08-29

This record distinguishes credentialed sponsor evidence from the deterministic fixture.

- EvidenceForge task: `task-8c7bae8b-6fa1-411d-a74b-29a4fd644d0d`
- Observed external write: [GitHub PR #9](https://github.com/cmdr-chara/evidenceforge/pull/9)
- Reconciled PR head: `efd969a9224f2d7978e8d0fdc413bd2080df8aa4`
- Application certificate digest: `29ddeb8abbba98749c0dcacdf175f9b1bf3536b0e5863d8505b11306818c7411`

The live workflow paused before the exact pull-request action. After a human approved that action, TrueForge invoked the configured GitHub MCP `create_pull_request` tool. EvidenceForge then used the authoritative `pull_request_read` result to bind the observed repository, base, head, and pull-request identity before `CompletionGate` issued its certificate.

PR #9 remains open and unmerged. The 10/10 result is EvidenceForge's configured ten-criterion product contract; it is not a hackathon score and does not certify a repository merge.
