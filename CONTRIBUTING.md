# Contributing

## Workflow

1. Open or reference an issue.
2. Branch from `determination` using a focused name such as `feat/completion-gate`.
3. Make one coherent change with tests.
4. Run the full local verification suite.
5. Open a pull request with evidence and residual risks.
6. Run Qodo Agentic Review.
7. Fix every valid High finding or document a reasoned dismissal.
8. Re-run Qodo review after changes.
9. Merge only after CI and human review are green.

Direct substantive pushes to `determination`, force-pushes, fabricated review records, and mixed “stuff” commits are not acceptable.

## Commit style

Examples:

```text
feat(workflow): add guarded verification transition
test(policy): reject unknown-risk external writes
fix(github): reconcile timed-out PR creation
docs(adr): explain evidence-gated completion
```

## Security

Do not commit secrets. Do not copy model or MCP credentials into the sandbox. Report vulnerabilities privately rather than opening a public exploit issue.
