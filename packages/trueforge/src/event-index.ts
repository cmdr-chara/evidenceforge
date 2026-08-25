import { isDeepStrictEqual } from "node:util";
import { ToolResult } from "../../domain/src/types";

type UnknownRecord = Record<string, unknown>;

export interface IndexedToolCall {
  id: string;
  sourceEventId: string;
  threadId: string;
  name: string;
  arguments: string;
  toolType?: string;
  serverName?: string;
}

export interface IndexedApproval {
  eventId: string;
  threadId: string;
  toolCalls: IndexedToolCall[];
}

export class TrueForgeEventIndex {
  private readonly toolCalls = new Map<string, IndexedToolCall>();

  public ingest(raw: unknown): void {
    const event = asRecord(raw);
    const type = readString(event, "type");
    if (type !== "model.message") return;
    const sourceEventId = requireString(event, "id");
    const threadId = readString(event, "threadId") ?? readString(event, "thread_id") ?? "main";
    const calls = event.toolCalls ?? event.tool_calls;
    if (!Array.isArray(calls)) return;
    for (const value of calls) {
      const call = asRecord(value);
      const id = readString(call, "id");
      const fn = asRecord(call.function);
      const name = readString(fn, "name");
      if (id === undefined || name === undefined) continue;
      const info = asRecord(call.toolInfo ?? call.tool_info);
      this.registerToolCall({
        id,
        sourceEventId,
        threadId,
        name,
        arguments: readString(fn, "arguments") ?? "{}",
        toolType: readString(info, "type"),
        serverName: readString(info, "serverName") ?? readString(info, "server_name"),
      });
    }
  }

  public registerToolCall(call: IndexedToolCall): void {
    const snapshot = structuredClone(call);
    const existing = this.toolCalls.get(call.id);
    if (existing !== undefined) {
      if (!sameToolCall(existing, snapshot)) {
        throw new Error(`tool call ${call.id} was redefined with different arguments or identity`);
      }
      return;
    }
    this.toolCalls.set(call.id, snapshot);
  }

  public toolResultFrom(raw: unknown, durationMs = 0): ToolResult {
    const event = asRecord(raw);
    if (readString(event, "type") !== "tool.response") {
      throw new Error("expected a TrueForge tool.response event");
    }
    const eventId = requireString(event, "id");
    const callId = requireStringFrom(event, ["toolCallId", "tool_call_id"]);
    const content = requireString(event, "content");
    const indexed = this.toolCalls.get(callId);
    if (indexed === undefined) {
      throw new Error(`tool response ${eventId} references unknown call ${callId}`);
    }
    const structured = authoritativePayload(parseContent(content));
    return {
      callId,
      eventId,
      tool: indexed.serverName === undefined ? indexed.name : `${indexed.serverName}.${indexed.name}`,
      status: readStatus(structured),
      retryable: readBoolean(structured, "retryable") ?? false,
      errorCode: readString(structured, "errorCode") ?? readString(structured, "error_code"),
      artifactRefs:
        readStringArray(structured, "artifactRefs") ??
        readStringArray(structured, "artifact_refs") ??
        [],
      evidenceIds: [],
      durationMs:
        readNumber(structured, "durationMs") ??
        readNumber(structured, "duration_ms") ??
        durationMs,
      exitCode: readNumber(structured, "exitCode") ?? readNumber(structured, "exit_code"),
      stdoutPreview:
        readString(structured, "stdoutPreview") ?? readString(structured, "stdout") ?? content,
      stderrPreview: readString(structured, "stderrPreview") ?? readString(structured, "stderr"),
    };
  }

  public approvalFrom(raw: unknown): IndexedApproval {
    const event = asRecord(raw);
    if (readString(event, "type") !== "tool.approval_required") {
      throw new Error("expected a TrueForge tool.approval_required event");
    }
    const eventId = requireString(event, "id");
    const threadId = readString(event, "threadId") ?? readString(event, "thread_id") ?? "main";
    const refs = event.toolCalls ?? event.tool_calls;
    if (!Array.isArray(refs)) throw new Error("approval event has no toolCalls");
    const calls = refs.map((value) => {
      const ref = asRecord(value);
      const id = requireString(ref, "id");
      const call = this.toolCalls.get(id);
      if (call === undefined) throw new Error(`approval ${eventId} references unknown call ${id}`);
      return structuredClone(call);
    });
    return { eventId, threadId, toolCalls: calls };
  }

  public getToolCall(id: string): IndexedToolCall | undefined {
    const call = this.toolCalls.get(id);
    return call === undefined ? undefined : structuredClone(call);
  }
}

function sameToolCall(left: IndexedToolCall, right: IndexedToolCall): boolean {
  return isDeepStrictEqual(
    {
      id: left.id,
      threadId: left.threadId,
      name: left.name,
      arguments: left.arguments,
      toolType: left.toolType,
      serverName: left.serverName,
    },
    {
      id: right.id,
      threadId: right.threadId,
      name: right.name,
      arguments: right.arguments,
      toolType: right.toolType,
      serverName: right.serverName,
    },
  );
}

function parseContent(content: string): UnknownRecord {
  try {
    const parsed: unknown = JSON.parse(content);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Fall through to a deterministic schema failure below.
  }
  return {
    status: "ERROR",
    retryable: false,
    errorCode: "MALFORMED_TOOL_RESPONSE",
    stderrPreview: content,
  };
}

function authoritativePayload(record: UnknownRecord): UnknownRecord {
  const output = asRecord(record.output);
  const nestedResult = asRecord(output.result);
  if (Object.keys(nestedResult).length > 0) return nestedResult;

  const directResult = asRecord(record.result);
  if (Object.keys(directResult).length > 0) return directResult;

  if (Object.keys(output).length > 0 && hasResultFields(output)) return output;

  if (readBoolean(record, "success") === false) {
    return {
      status: "ERROR",
      retryable: false,
      errorCode:
        readString(record, "errorCode") ??
        readString(record, "error_code") ??
        "TOOL_RESPONSE_UNSUCCESSFUL",
      stderrPreview: readErrorMessage(record.error) ?? JSON.stringify(record),
    };
  }

  return record;
}

function hasResultFields(record: UnknownRecord): boolean {
  return [
    "status",
    "exitCode",
    "exit_code",
    "stdout",
    "stderr",
    "artifactRefs",
    "artifact_refs",
  ].some((key) => record[key] !== undefined);
}

function readErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return readString(record, "message") ?? readString(record, "detail");
}

function readStatus(record: UnknownRecord): ToolResult["status"] {
  const status = readString(record, "status")?.toUpperCase();
  if (status === "OK" || status === "ERROR" || status === "DENIED" || status === "TIMEOUT") {
    return status;
  }
  const exit = readNumber(record, "exitCode") ?? readNumber(record, "exit_code");
  return exit === undefined || exit === 0 ? "OK" : "ERROR";
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function requireString(record: UnknownRecord, key: string): string {
  const value = readString(record, key);
  if (value === undefined) throw new Error(`missing string field ${key}`);
  return value;
}

function requireStringFrom(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = readString(record, key);
    if (value !== undefined) return value;
  }
  throw new Error(`missing string field ${keys.join(" or ")}`);
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: UnknownRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(record: UnknownRecord, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(record: UnknownRecord, key: string): string[] | undefined {
  const value = record[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}
