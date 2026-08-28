import { randomUUID } from "node:crypto";
import { RuntimeEvent, RuntimeEventType } from "../../domain/src/types";

export interface NormalizedStreamItem {
  event: RuntimeEvent;
  raw: unknown;
}

type UnknownRecord = Record<string, unknown>;

export function normalizeTrueForgeEvent(
  raw: unknown,
  sequenceNumber?: number,
  now = new Date().toISOString(),
): NormalizedStreamItem {
  const record = asRecord(raw);
  const rawType = readString(record, "type") ?? "unknown";
  const id = readString(record, "id") ?? `tf-event-${randomUUID()}`;
  const threadId = readString(record, "threadId") ?? readString(record, "thread_id");
  return {
    raw,
    event: {
      id,
      type: mapEventType(rawType),
      source: `trueforge:${rawType}`,
      threadId,
      timestamp: readString(record, "timestamp") ?? readString(record, "createdAt") ?? now,
      payload: structuredClone(raw),
      sequenceNumber,
    },
  };
}

function mapEventType(type: string): RuntimeEventType {
  switch (type) {
    case "turn.created":
      return "TURN_CREATED";
    case "turn.done":
      return "TURN_DONE";
    case "model.message":
    case "model.message.delta":
      return "MODEL_MESSAGE";
    case "thread.created":
      return "THREAD_CREATED";
    case "thread.done":
      return "THREAD_DONE";
    case "sandbox.created":
      return "SANDBOX_CREATED";
    case "tool.approval_required":
    case "tool.response_required":
      return "APPROVAL";
    case "mcp.auth_required":
      return "AUTH_REQUIRED";
    case "tool.response":
      return "TOOL_RESULT";
    default:
      return "MODEL_MESSAGE";
  }
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
