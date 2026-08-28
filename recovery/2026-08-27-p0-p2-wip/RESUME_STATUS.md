# P0/P1/P2 resume status

Recovery resumed from branch head `98357efaa00692001a45779331d924db6fa39bb2`.

This file is a durable progress marker. Functional snapshots under this directory are being reviewed and reactivated into source paths in serialized commits. No recovered snapshot is considered verified until exact-head CI passes.

Rules retained:
- branch remains `feat/foundation-control-plane`;
- PR #2 remains open and unmerged;
- `determination` is not modified directly;
- `.evidenceforge/` remains ignored and is not migrated or committed;
- TrueForge remains the primary runtime;
- `COMPLETED` remains certificate-only;
- P0.4 remains blocked unless TrueForge SDK 0.1.3 exposes a real pre-execution subagent tool-enforcement hook.
