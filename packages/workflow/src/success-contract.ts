import { pendingCriterion, SuccessCriterion, Task } from "../../domain/src";

export function buildCiSuccessContract(task: Task): SuccessCriterion[] {
  const cwd = "/workspace/repository";
  return [
    pendingCriterion(
      "incident-context",
      "Authoritative incident context retrieved",
      {
        kind: "SCHEMA_FILE",
        artifactRef: `artifact://${task.id}/incident-context.json`,
        schemaName: "IncidentContext",
      },
      true,
      "INCIDENT",
    ),
    pendingCriterion("failure-reproduced", "Original failure independently reproduced", {
      kind: "FAILURE_SIGNATURE",
      argv: ["node", "--test", "demo/incident-fixture/test/config.test.mjs"],
      cwd,
      expectedNonZeroExit: true,
      signature: "CONFIG_VALIDATION_ORDER",
      timeoutSeconds: 180,
    }),
    pendingCriterion(
      "root-cause-supported",
      "Root-cause hypothesis supported by evidence",
      {
        kind: "SCHEMA_FILE",
        artifactRef: `artifact://${task.id}/hypothesis-ledger.json`,
        schemaName: "HypothesisLedger",
      },
      true,
      "INCIDENT",
    ),
    pendingCriterion("regression", "Regression verifier passes post-patch", {
      kind: "COMMAND",
      argv: ["node", "--test", "demo/incident-fixture/test/config.test.mjs"],
      cwd,
      expectedExitCode: 0,
      outputMustContain: ["pass"],
      timeoutSeconds: 180,
      purpose: "VERIFICATION",
    }),
    pendingCriterion("targeted-tests", "Relevant test suite passes", {
      kind: "COMMAND",
      argv: ["pnpm", "test"],
      cwd,
      expectedExitCode: 0,
      timeoutSeconds: 300,
      purpose: "VERIFICATION",
    }),
    pendingCriterion("typecheck", "Typecheck passes when applicable", {
      kind: "COMMAND",
      argv: ["pnpm", "typecheck"],
      cwd,
      expectedExitCode: 0,
      timeoutSeconds: 180,
      purpose: "VERIFICATION",
    }),
    pendingCriterion("lint", "Lint/static checks pass when applicable", {
      kind: "COMMAND",
      argv: ["pnpm", "lint"],
      cwd,
      expectedExitCode: 0,
      timeoutSeconds: 180,
      purpose: "VERIFICATION",
    }),
    pendingCriterion("diff-integrity", "Diff integrity check passes", {
      kind: "DIFF_INTEGRITY",
      cwd,
      timeoutSeconds: 60,
    }),
    pendingCriterion("independent-review", "Independent reviewer finds no critical blocker", {
      kind: "REVIEWER",
      allowedVerdicts: ["PASS", "PASS_WITH_WARNINGS"],
    }),
    pendingCriterion("external-pr", "Resulting pull request is reconciled and recorded", {
      kind: "EXTERNAL_STATE",
      actionType: "pull_request",
    }),
  ];
}
