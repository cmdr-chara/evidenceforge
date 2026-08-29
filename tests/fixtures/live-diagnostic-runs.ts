import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { RuntimeEvent } from "../../packages/domain/src";

export type LiveDiagnosticRunFixture =
  | "luna-schema"
  | "luna-unobserved-reference"
  | "sol-schema";

const LIVE_DIAGNOSTIC_FIXTURE_DIGESTS: Record<LiveDiagnosticRunFixture, string> = {
  "luna-schema": "d3f88ec7451deb606b82d169f18ab1c590f8ee228d6ba6ab644469ed8767f8d0",
  "luna-unobserved-reference": "be5499e0bd35b814dc560cc961e8fd64200d2fd814fb2fe4e4e31727a9bd210a",
  "sol-schema": "ffeebe7e30a38c57310292c911dc491b6539aaa50b50a63a1e38b91a8e992cd8",
};

export const LIVE_DIAGNOSTIC_EVENT_IDS = {
  lunaSchemaDone: "01m16gea4hwdv57gqdxd623h2f",
  lunaUnobservedFailedResult: "01m16h0pds4qwam9na2rhh7p6p",
  lunaUnobservedDone: "01m16h2atdbb0s2fqzdb6zgbp5",
  solSchemaDone: "01m16jhnc496g50a0zgd1vmecr",
} as const;

export function loadLiveDiagnosticRunFixture(
  fixture: LiveDiagnosticRunFixture,
): RuntimeEvent[] {
  const path = join(
    process.cwd(),
    "tests",
    "fixtures",
    "live-diagnostic-runs",
    `${fixture}.jsonl.gz`,
  );
  const raw = gunzipSync(readFileSync(path));
  const digest = createHash("sha256").update(raw).digest("hex");
  if (digest !== LIVE_DIAGNOSTIC_FIXTURE_DIGESTS[fixture]) {
    throw new Error(`live diagnostic fixture digest mismatch: ${fixture}`);
  }
  const content = raw.toString("utf8").trimEnd();
  if (content.length === 0) throw new Error(`empty live diagnostic fixture: ${fixture}`);
  return content.split("\n").map((line, index) => {
    const parsed = JSON.parse(line) as unknown;
    if (!isRuntimeEvent(parsed)) {
      throw new Error(`invalid runtime event in ${fixture} at line ${index + 1}`);
    }
    return parsed;
  });
}

export function requiredRuntimeEvent(
  events: RuntimeEvent[],
  eventId: string,
): RuntimeEvent {
  const event = events.find((candidate) => candidate.id === eventId);
  if (event === undefined) throw new Error(`missing runtime event ${eventId}`);
  return event;
}

export function diagnosticOutputFrom(event: RuntimeEvent): Record<string, unknown> {
  const payload = asRecord(event.payload);
  const state = asRecord(payload.state);
  const output = asRecord(state.output);
  const content = output.content;
  if (typeof content !== "string") {
    throw new Error(`runtime event ${event.id} has no diagnostic output content`);
  }
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`runtime event ${event.id} diagnostic output is not an object`);
  }
  return parsed;
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.source === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.sequenceNumber === "number" &&
    "payload" in value
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
