import { isDeepStrictEqual } from "node:util";
import { isEventDelta, mergeEventDelta } from "@truefoundry/trueforge-sdk";
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
  private readonly streamedModelMessages = new Map<string, UnknownRecord>();

  public ingest(raw: unknown): void {
    const event = asRecord(raw);
    const type = readString(event, "type");
    if (type === "model.message.delta") {
      this.ingestModelMessageDelta(event);
      return;
    }
    if (type !== "model.message") return;

    const sourceEventId = requireString(event, "id");
    const snapshot = structuredClone(event);
    this.streamedModelMessages.set(sourceEventId, snapshot);
    this.indexModelMessage(snapshot);
  }

  private ingestModelMessageDelta(event: UnknownRecord): void {
    const sourceEventId = requireString(event, "id");
    const message = this.streamedModelMessages.get(sourceEventId);
    const delta = event as unknown as Parameters<typeof mergeEventDelta>[1];
    if (message === undefined || !isEventDelta(delta)) return;

    mergeEventDelta(
      message as unknown as Parameters<typeof mergeEventDelta>[0],
      delta,
    );
    if (event.finishReason !== undefined) this.indexModelMessage(message);
  }

  private indexModelMessage(event: UnknownRecord): void {
    const sourceEventId = requireString(event, "id");
    const threadId = readStringFrom(event, ["threadId", "thread_id"]) ?? "main";
    const calls = event.toolCalls ?? event.tool_calls;
    if (!Array.isArray(calls)) return;

    for (const value of calls) {
      const call = asRecord(value);
      const id = readString(call, "id");
      const fn = asRecord(call.function);
      const invokedName = readString(fn, "name");
      if (id === undefined || invokedName === undefined) continue;

      const info = asRecord(call.toolInfo ?? call.tool_info);
      const toolType = readString(info, "type");
      const name =
        readStringFrom(info, ["originalToolName", "original_tool_name"]) ?? invokedName;
      const configuredServerName = readStringFrom(info, [
        "serverName",
        "server_name",
        "mcpServerName",
        "mcp_server_name",
      ]);
      const systemToolName = toolType === "truefoundry-system" ? readString(info, "name") : undefined;
      const serverName =
        configuredServerName ??
        (name === "exec" && (systemToolName === "sandbox" || systemToolName === "exec")
          ? "sandbox"
          : undefined);

      this.registerToolCall({
        id,
        sourceEventId,
        threadId,
        name,
        arguments: readString(fn, "arguments") ?? "{}",
        toolType,
        serverName,
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

    const parsed = parseContent(content);
    const structured = isSandboxExec(indexed)
      ? normalizeSandboxExecPayload(parsed, content, durationMs)
      : normalizeGenericPayload(parsed, content, durationMs);

    return {
      callId,
      eventId,
      tool: indexed.serverName === undefined ? indexed.name : `${indexed.serverName}.${indexed.name}`,
      status: requireToolStatus(structured),
      retryable: readBoolean(structured, "retryable") ?? false,
      errorCode: readStringFrom(structured, ["errorCode", "error_code"]),
      artifactRefs:
        readStringArray(structured, "artifactRefs") ??
        readStringArray(structured, "artifact_refs") ??
        [],
      evidenceIds: [],
      durationMs:
        readNumber(structured, "durationMs") ??
        readNumber(structured, "duration_ms") ??
        durationMs,
      exitCode: readNumberFrom(structured, ["exitCode", "exit_code"]),
      stdoutPreview: readStringFrom(structured, ["stdoutPreview", "stdout"]),
      stderrPreview: readStringFrom(structured, ["stderrPreview", "stderr"]),
    };
  }

  public approvalFrom(raw: unknown): IndexedApproval {
    const event = asRecord(raw);
    if (readString(event, "type") !== "tool.approval_required") {
      throw new Error("expected a TrueForge tool.approval_required event");
    }

    const eventId = requireString(event, "id");
    const threadId = readStringFrom(event, ["threadId", "thread_id"]) ?? "main";
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

function normalizeSandboxExecPayload(
  record: UnknownRecord,
  rawContent: string,
  fallbackDurationMs: number,
): UnknownRecord {
  const durationMs =
    readNumberFrom(record, ["durationMs", "duration_ms"]) ?? fallbackDurationMs;
  const artifactRefs =
    readStringArray(record, "artifactRefs") ??
    readStringArray(record, "artifact_refs") ??
    [];
  const success = readBoolean(record, "success");

  if (success === true) {
    const response = asRecord(record.response);
    const exitCode = readNumberFrom(response, ["exitCode", "exit_code"]);
    const result = readString(response, "result");
    if (exitCode === undefined || result === undefined) {
      return malformedPayload(rawContent, durationMs, artifactRefs);
    }
    return {
      status: "OK",
      retryable: false,
      artifactRefs,
      durationMs,
      exitCode,
      stdoutPreview: result,
    };
  }

  if (success === false) {
    const error = readErrorMessage(record.error);
    if (error === undefined) return malformedPayload(rawContent, durationMs, artifactRefs);
    return {
      status: "ERROR",
      retryable: isTransientInfrastructureError(error),
      errorCode: "SANDBOX_INFRASTRUCTURE_ERROR",
      artifactRefs,
      durationMs,
      stderrPreview: error,
    };
  }

  return malformedPayload(rawContent, durationMs, artifactRefs);
}

function normalizeGenericPayload(
  record: UnknownRecord,
  rawContent: string,
  fallbackDurationMs: number,
): UnknownRecord {
  const candidate = unwrapGenericPayload(record);
  const status = readGenericStatus(candidate);
  return {
    ...candidate,
    status,
    retryable: readBoolean(candidate, "retryable") ?? false,
    durationMs:
      readNumberFrom(candidate, ["durationMs", "duration_ms"]) ?? fallbackDurationMs,
    stdoutPreview:
      readStringFrom(candidate, ["stdoutPreview", "stdout"]) ??
      (status === "OK" ? rawContent : undefined),
    stderrPreview:
      readStringFrom(candidate, ["stderrPreview", "stderr"]) ??
      readErrorMessage(candidate.error) ??
      (status === "ERROR" ? rawContent : undefined),
  };
}

function unwrapGenericPayload(record: UnknownRecord): UnknownRecord {
  const output = asRecord(record.output);
  const nestedOutputResult = asRecord(output.result);
  if (Object.keys(nestedOutputResult).length > 0) return nestedOutputResult;

  const directResult = asRecord(record.result);
  if (Object.keys(directResult).length > 0) return directResult;
  if (Object.keys(output).length > 0 && hasResultFields(output)) return output;

  if (readBoolean(record, "success") === false) {
    return {
      status: "ERROR",
      retryable: false,
      errorCode:
        readStringFrom(record, ["errorCode", "error_code"]) ??
        "TOOL_RESPONSE_UNSUCCESSFUL",
      stderrPreview: readErrorMessage(record.error) ?? JSON.stringify(record),
    };
  }
  return record;
}

function malformedPayload(
  rawContent: string,
  durationMs: number,
  artifactRefs: string[],
): UnknownRecord {
  return {
    status: "ERROR",
    retryable: false,
    errorCode: "MALFORMED_TOOL_RESPONSE",
    artifactRefs,
    durationMs,
    stderrPreview: rawContent,
  };
}

function readGenericStatus(record: UnknownRecord): ToolResult["status"] {
  const explicit = readString(record, "status")?.toUpperCase();
  if (explicit === "OK" || explicit === "ERROR" || explicit === "DENIED" || explicit === "TIMEOUT") {
    return explicit;
  }
  if (explicit === "FAILED" || explicit === "FAILURE") return "ERROR";
  if (readErrorMessage(record.error) !== undefined) return "ERROR";
  const exitCode = readNumberFrom(record, ["exitCode", "exit_code"]);
  return exitCode === undefined || exitCode === 0 ? "OK" : "ERROR";
}

function requireToolStatus(record: UnknownRecord): ToolResult["status"] {
  const status = readString(record, "status");
  if (status === "OK" || status === "ERROR" || status === "DENIED" || status === "TIMEOUT") {
    return status;
  }
  throw new Error("normalized tool response has no valid status");
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

function isSandboxExec(call: IndexedToolCall): boolean {
  return (
    call.name === "exec" &&
    (call.serverName === "sandbox" || call.toolType === "truefoundry-system")
  );
}

function isTransientInfrastructureError(message: string): boolean {
  return /timeout|temporar|unavailable|connection|network|rate limit|429|5\d\d/i.test(message);
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

function readErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return readString(record, "message") ?? readString(record, "detail");
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
  const value = readStringFrom(record, keys);
  if (value === undefined) throw new Error(`missing string field ${keys.join(" or ")}`);
  return value;
}

function readStringFrom(record: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readString(record, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumberFrom(record: UnknownRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = readNumber(record, key);
    if (value !== undefined) return value;
  }
  return undefined;
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
