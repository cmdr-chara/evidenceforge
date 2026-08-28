export const DIAGNOSTIC_OUTPUT_SCHEMA_VERSION = 1 as const;
export const DIAGNOSTIC_OUTPUT_MAX_CHARACTERS = 8_192;
export const DIAGNOSTIC_ROOT_CAUSE_MAX_CLAIMS = 5;
export const DIAGNOSTIC_TEXT_MAX_CHARACTERS = 1_024;
export const DIAGNOSTIC_REFERENCE_MAX_CHARACTERS = 256;
export const DIAGNOSTIC_REFERENCE_MAX_COUNT = 10;

export interface DiagnosticRootCauseClaim {
  id: string;
  cause: string;
  causalMechanism: string;
  affectedLocations: string[];
  evidenceReferences: string[];
  status: "SUPPORTED" | "CONFIRMED";
}

export interface DiagnosticSpecialistOutput {
  schemaVersion: typeof DIAGNOSTIC_OUTPUT_SCHEMA_VERSION;
  findings: string[];
  rootCauseHypotheses: DiagnosticRootCauseClaim[];
  unresolvedQuestions: string[];
}

export const DIAGNOSTIC_OUTPUT_PROTOCOL = [
  "Return only one JSON object with no prose or code fence.",
  "It must use schemaVersion 1 and exactly these fields:",
  '{"schemaVersion":1,"findings":["<bounded observation>"],"rootCauseHypotheses":[{"id":"<stable-id>","cause":"<specific defect or configuration condition>","causalMechanism":"<how that cause produces the observed failure>","affectedLocations":["<path:symbol or configuration key>"],"evidenceReferences":["<bounded file, symbol, log signature, or artifact reference>"],"status":"SUPPORTED"}],"unresolvedQuestions":[]}.',
  "Use SUPPORTED or CONFIRMED only for a causal claim backed by the listed evidence references; otherwise return an empty rootCauseHypotheses array rather than guessing.",
].join(" ");

export function parseDiagnosticSpecialistOutput(
  value: unknown,
): DiagnosticSpecialistOutput | undefined {
  if (!isRecord(value) || value.schemaVersion !== DIAGNOSTIC_OUTPUT_SCHEMA_VERSION) {
    return undefined;
  }
  const findings = readBoundedStringArray(value.findings, 0, DIAGNOSTIC_REFERENCE_MAX_COUNT);
  const unresolvedQuestions = readBoundedStringArray(
    value.unresolvedQuestions,
    0,
    DIAGNOSTIC_REFERENCE_MAX_COUNT,
  );
  if (findings === undefined || unresolvedQuestions === undefined) return undefined;
  if (
    !Array.isArray(value.rootCauseHypotheses) ||
    value.rootCauseHypotheses.length > DIAGNOSTIC_ROOT_CAUSE_MAX_CLAIMS
  ) {
    return undefined;
  }

  const rootCauseHypotheses: DiagnosticRootCauseClaim[] = [];
  const ids = new Set<string>();
  for (const rawClaim of value.rootCauseHypotheses) {
    const claim = parseRootCauseClaim(rawClaim);
    if (claim === undefined || ids.has(claim.id)) return undefined;
    ids.add(claim.id);
    rootCauseHypotheses.push(claim);
  }

  return {
    schemaVersion: DIAGNOSTIC_OUTPUT_SCHEMA_VERSION,
    findings,
    rootCauseHypotheses,
    unresolvedQuestions,
  };
}

function parseRootCauseClaim(value: unknown): DiagnosticRootCauseClaim | undefined {
  if (!isRecord(value)) return undefined;
  const id = readBoundedString(value.id, 1, 128);
  const cause = readBoundedString(value.cause, 16, 512);
  const causalMechanism = readBoundedString(value.causalMechanism, 16, DIAGNOSTIC_TEXT_MAX_CHARACTERS);
  const affectedLocations = readBoundedStringArray(
    value.affectedLocations,
    1,
    DIAGNOSTIC_REFERENCE_MAX_COUNT,
  );
  const evidenceReferences = readBoundedStringArray(
    value.evidenceReferences,
    1,
    DIAGNOSTIC_REFERENCE_MAX_COUNT,
  );
  const status = value.status;
  if (
    id === undefined ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(id) ||
    cause === undefined ||
    causalMechanism === undefined ||
    cause === causalMechanism ||
    affectedLocations === undefined ||
    evidenceReferences === undefined ||
    (status !== "SUPPORTED" && status !== "CONFIRMED")
  ) {
    return undefined;
  }
  return {
    id,
    cause,
    causalMechanism,
    affectedLocations,
    evidenceReferences,
    status,
  };
}

function readBoundedStringArray(
  value: unknown,
  minimumCount: number,
  maximumCount: number,
): string[] | undefined {
  if (!Array.isArray(value) || value.length < minimumCount || value.length > maximumCount) {
    return undefined;
  }
  const parsed: string[] = [];
  for (const item of value) {
    const text = readBoundedString(item, 1, DIAGNOSTIC_REFERENCE_MAX_CHARACTERS);
    if (text === undefined || parsed.includes(text)) return undefined;
    parsed.push(text);
  }
  return parsed;
}

function readBoundedString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length >= minimumLength && trimmed.length <= maximumLength
    ? trimmed
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
