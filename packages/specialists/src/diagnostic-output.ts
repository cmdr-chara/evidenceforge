export const DIAGNOSTIC_OUTPUT_SCHEMA_VERSION = 1 as const;
export const DIAGNOSTIC_OUTPUT_MAX_CHARACTERS = 8_192;
export const DIAGNOSTIC_ROOT_CAUSE_MAX_CLAIMS = 5;
export const DIAGNOSTIC_ID_MAX_CHARACTERS = 128;
export const DIAGNOSTIC_CAUSE_MIN_CHARACTERS = 16;
export const DIAGNOSTIC_CAUSE_MAX_CHARACTERS = 512;
export const DIAGNOSTIC_MECHANISM_MIN_CHARACTERS = 16;
export const DIAGNOSTIC_TEXT_MAX_CHARACTERS = 1_024;
export const DIAGNOSTIC_OBSERVATION_MAX_CHARACTERS = 1_024;
export const DIAGNOSTIC_REFERENCE_MAX_CHARACTERS = 256;
export const DIAGNOSTIC_REFERENCE_MAX_COUNT = 10;

const DIAGNOSTIC_OUTPUT_FIELDS = [
  "schemaVersion",
  "findings",
  "rootCauseHypotheses",
  "unresolvedQuestions",
] as const;
const DIAGNOSTIC_ROOT_CAUSE_FIELDS = [
  "id",
  "cause",
  "causalMechanism",
  "affectedLocations",
  "evidenceReferences",
  "status",
] as const;

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
  "The top-level object and every root-cause object must contain exactly the displayed keys; wrappers, aliases, unknown fields, scalar substitutions, prose, and code fences are invalid.",
  'When no causal claim is supported, return exactly this shape: {"schemaVersion":1,"findings":["<bounded observation>"],"rootCauseHypotheses":[],"unresolvedQuestions":[]}. Do not move affectedLocations, evidenceReferences, or status to the top level.',
  `findings and unresolvedQuestions may each contain at most ${DIAGNOSTIC_REFERENCE_MAX_COUNT} unique strings of 1-${DIAGNOSTIC_OBSERVATION_MAX_CHARACTERS} characters.`,
  `affectedLocations and evidenceReferences may each contain at most ${DIAGNOSTIC_REFERENCE_MAX_COUNT} unique strings of at most ${DIAGNOSTIC_REFERENCE_MAX_CHARACTERS} characters; every evidence reference must contain at least 8 characters.`,
  `Each id must contain 1-${DIAGNOSTIC_ID_MAX_CHARACTERS} characters and match letters, digits, dot, underscore, or hyphen; each cause must contain ${DIAGNOSTIC_CAUSE_MIN_CHARACTERS}-${DIAGNOSTIC_CAUSE_MAX_CHARACTERS} characters; each causalMechanism must contain ${DIAGNOSTIC_MECHANISM_MIN_CHARACTERS}-${DIAGNOSTIC_TEXT_MAX_CHARACTERS} characters.`,
  `The entire serialized JSON object must not exceed ${DIAGNOSTIC_OUTPUT_MAX_CHARACTERS} characters, including field names and JSON punctuation.`,
  "EvidenceForge preserves accepted text after trimming outer whitespace; it does not truncate, rewrite, infer, or reclassify it.",
  "Every evidenceReferences entry must be an exact bounded string observed in a completed tool result from this specialist thread; EvidenceForge rejects unresolved or cross-thread references.",
  "Use SUPPORTED or CONFIRMED only for a causal claim backed by those recorded tool results; otherwise return an empty rootCauseHypotheses array rather than guessing.",
].join(" ");

export function parseDiagnosticSpecialistOutput(
  value: unknown,
): DiagnosticSpecialistOutput | undefined {
  if (
    !isRecord(value) ||
    !hasExactFields(value, DIAGNOSTIC_OUTPUT_FIELDS) ||
    value.schemaVersion !== DIAGNOSTIC_OUTPUT_SCHEMA_VERSION
  ) {
    return undefined;
  }
  const findings = readBoundedStringArray(
    value.findings,
    0,
    DIAGNOSTIC_REFERENCE_MAX_COUNT,
    1,
    DIAGNOSTIC_OBSERVATION_MAX_CHARACTERS,
  );
  const unresolvedQuestions = readBoundedStringArray(
    value.unresolvedQuestions,
    0,
    DIAGNOSTIC_REFERENCE_MAX_COUNT,
    1,
    DIAGNOSTIC_OBSERVATION_MAX_CHARACTERS,
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
  if (!isRecord(value) || !hasExactFields(value, DIAGNOSTIC_ROOT_CAUSE_FIELDS)) {
    return undefined;
  }
  const id = readBoundedString(value.id, 1, DIAGNOSTIC_ID_MAX_CHARACTERS);
  const cause = readBoundedString(
    value.cause,
    DIAGNOSTIC_CAUSE_MIN_CHARACTERS,
    DIAGNOSTIC_CAUSE_MAX_CHARACTERS,
  );
  const causalMechanism = readBoundedString(
    value.causalMechanism,
    DIAGNOSTIC_MECHANISM_MIN_CHARACTERS,
    DIAGNOSTIC_TEXT_MAX_CHARACTERS,
  );
  const affectedLocations = readBoundedStringArray(
    value.affectedLocations,
    1,
    DIAGNOSTIC_REFERENCE_MAX_COUNT,
    1,
    DIAGNOSTIC_REFERENCE_MAX_CHARACTERS,
  );
  const evidenceReferences = readBoundedStringArray(
    value.evidenceReferences,
    1,
    DIAGNOSTIC_REFERENCE_MAX_COUNT,
    8,
    DIAGNOSTIC_REFERENCE_MAX_CHARACTERS,
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
  minimumLength: number,
  maximumLength: number,
): string[] | undefined {
  if (!Array.isArray(value) || value.length < minimumCount || value.length > maximumCount) {
    return undefined;
  }
  const parsed: string[] = [];
  for (const item of value) {
    const text = readBoundedString(item, minimumLength, maximumLength);
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

function hasExactFields(
  value: Record<string, unknown>,
  expectedFields: readonly string[],
): boolean {
  const fields = Object.keys(value);
  return (
    fields.length === expectedFields.length &&
    expectedFields.every((field) => Object.hasOwn(value, field))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
