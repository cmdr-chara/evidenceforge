export interface SpecialistDefinition {
  id: "repository-investigator" | "failure-investigator" | "dependency-config-investigator";
  name: string;
  purpose: string;
  readOnly: true;
  sharesWorkspace: true;
  allowedCapabilities: string[];
  forbiddenCapabilities: string[];
  instructions: string;
}

export const DIAGNOSTIC_SPECIALISTS: readonly SpecialistDefinition[] = Object.freeze([
  {
    id: "repository-investigator",
    name: "Repository Investigator",
    purpose: "Map the failure to likely files and symbols and produce evidence-backed hypotheses.",
    readOnly: true,
    sharesWorkspace: true,
    allowedCapabilities: ["repository search", "file read", "git history read"],
    forbiddenCapabilities: ["file write", "patch", "commit", "external write"],
    instructions:
      "Inspect only. Identify relevant files, symbols, control flow, and recent changes. Return structured findings, hypotheses, evidence references, and unresolved questions. Do not patch.",
  },
  {
    id: "failure-investigator",
    name: "Failure / Log Investigator",
    purpose: "Extract the stable failure signature and separate root errors from cascading noise.",
    readOnly: true,
    sharesWorkspace: true,
    allowedCapabilities: ["GitHub Actions read", "bounded log search", "artifact read"],
    forbiddenCapabilities: ["file write", "patch", "commit", "external write"],
    instructions:
      "Inspect the authoritative GitHub Actions failure and bounded log excerpts. Identify the first causal error, stable signature, and likely reproduction command. Do not patch.",
  },
  {
    id: "dependency-config-investigator",
    name: "Dependency / Configuration Investigator",
    purpose: "Test dependency, configuration, and CI/local-environment hypotheses using read-only evidence.",
    readOnly: true,
    sharesWorkspace: true,
    allowedCapabilities: ["manifest read", "lockfile read", "configuration read", "environment metadata read"],
    forbiddenCapabilities: ["file write", "dependency update", "patch", "commit", "external write"],
    instructions:
      "Inspect dependencies, lockfiles, configuration, and environment assumptions. Distinguish CI-only symptoms from source defects. Return structured evidence. Do not patch.",
  },
]);

export interface ReviewerDefinition {
  id: "independent-reviewer";
  receives: string[];
  excludes: string[];
  instructions: string;
}

export const INDEPENDENT_REVIEWER: ReviewerDefinition = Object.freeze({
  id: "independent-reviewer",
  receives: ["task", "final diff", "evidence summary", "verifier results", "success contract", "constraints"],
  excludes: ["patching transcript", "private reasoning", "unbounded raw logs"],
  instructions:
    "Review correctness, regression risk, maintainability, security, scope, and unsupported assumptions. Return PASS, PASS_WITH_WARNINGS, or BLOCK plus structured findings. Never override a deterministic failed verifier.",
});

export function assertDiagnosticTopology(definitions: readonly SpecialistDefinition[]): void {
  if (definitions.length !== 3) throw new Error("EvidenceForge requires exactly three diagnostic specialists");
  const ids = new Set(definitions.map((definition) => definition.id));
  if (ids.size !== 3) throw new Error("diagnostic specialist IDs must be unique");
  for (const definition of definitions) {
    if (!definition.readOnly || definition.forbiddenCapabilities.includes("file write") === false) {
      throw new Error(`${definition.name} must be explicitly read-only during fan-out`);
    }
  }
}
