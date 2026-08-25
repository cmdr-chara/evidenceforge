export interface EvaluationCase {
  id: "S1" | "S2" | "S3" | "S4" | "S5";
  name: string;
  description: string;
  oracleComplete: boolean;
  initialHypotheses: string[];
  expectedTerminal: "COMPLETED" | "ESCALATED";
  misleadingModelClaim?: boolean;
}

export const EVALUATION_CASES: readonly EvaluationCase[] = Object.freeze([
  {
    id: "S1",
    name: "configuration-order regression",
    description: "Test-mode fallback occurs after production-only environment validation.",
    oracleComplete: true,
    initialHypotheses: ["missing CI secret", "dependency regression", "validation-order regression"],
    expectedTerminal: "COMPLETED",
  },
  {
    id: "S2",
    name: "dependency/config mismatch",
    description: "Lockfile and CI package-manager versions disagree; source code is not the root cause.",
    oracleComplete: true,
    initialHypotheses: ["source regression", "lockfile mismatch", "runner image drift"],
    expectedTerminal: "COMPLETED",
  },
  {
    id: "S3",
    name: "source regression",
    description: "A source change violates an established behavior and needs a code fix plus regression test.",
    oracleComplete: true,
    initialHypotheses: ["flaky test", "source regression"],
    expectedTerminal: "COMPLETED",
  },
  {
    id: "S4",
    name: "misleading evidence",
    description: "A plausible missing-secret hypothesis is disproved before the supported root cause is fixed.",
    oracleComplete: true,
    initialHypotheses: ["missing secret", "configuration order"],
    expectedTerminal: "COMPLETED",
    misleadingModelClaim: true,
  },
  {
    id: "S5",
    name: "ambiguous/unresolvable",
    description: "The available artifacts cannot establish a stable failure signature or correctness oracle.",
    oracleComplete: false,
    initialHypotheses: ["transient infrastructure", "non-deterministic source defect"],
    expectedTerminal: "ESCALATED",
  },
]);
