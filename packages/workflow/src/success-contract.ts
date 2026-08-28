import { pendingCriterion, SuccessCriterion, Task } from "../../domain/src";

const PUBLIC_LIVE_INCIDENT = {
  repository: "cmdr-chara/evidenceforge",
  runId: "32892119950",
  revision: "9accc9e484e055c8b22172e389dc50f84315f4e2",
} as const;

export function buildCiSuccessContract(task: Task): SuccessCriterion[] {
  return buildContract(task, {
    reproductionArgv: ["node", "--test", "demo/incident-fixture/test/config.test.mjs"],
    reproductionSignature: "CONFIG_VALIDATION_ORDER",
    regressionArgv: ["node", "--test", "demo/incident-fixture/test/config.test.mjs"],
    regressionOutput: "pass",
  });
}

/**
 * Live profile for the public EvidenceForge Actions incident used by the demo.
 * The authoritative run failed in the unit suite at the sandbox-result
 * normalization regression; the deterministic fixture exercises a different
 * failure and must not be substituted for that live evidence.
 */
export function buildEvidenceForgeLiveCiSuccessContract(task: Task): SuccessCriterion[] {
  if (
    task.repository !== PUBLIC_LIVE_INCIDENT.repository ||
    task.source.runId !== PUBLIC_LIVE_INCIDENT.runId ||
    task.revision !== PUBLIC_LIVE_INCIDENT.revision
  ) {
    throw new Error("no application-owned live success-contract profile matches this incident");
  }
  return buildContract(task, {
    reproductionArgv: ["pnpm", "test:unit"],
    reproductionSignature:
      "authoritative TrueForge sandbox non-zero exit is never reported as OK",
    regressionArgv: ["pnpm", "test:unit"],
    regressionOutput: "pass",
  });
}

interface CiContractProfile {
  reproductionArgv: string[];
  reproductionSignature: string;
  regressionArgv: string[];
  regressionOutput: string;
}

function buildContract(task: Task, profile: CiContractProfile): SuccessCriterion[] {
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
      argv: profile.reproductionArgv,
      cwd,
      expectedNonZeroExit: true,
      signature: profile.reproductionSignature,
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
      argv: profile.regressionArgv,
      cwd,
      expectedExitCode: 0,
      outputMustContain: [profile.regressionOutput],
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
