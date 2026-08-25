import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { DemoWorkflow } from "./demo-workflow";
import { LiveIncidentService, StartLiveIncidentInput } from "./live-service";
import { SseBroker } from "./sse-broker";

const root = resolve(process.cwd());
const staticDirectory = join(root, "apps", "web", "public");
const port = Number.parseInt(process.env.EVIDENCEFORGE_PORT ?? "4173", 10);
const broker = new SseBroker();
const live = new LiveIncidentService(broker);
let demo = new DemoWorkflow();

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`EvidenceForge console: http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    broker.close();
    server.close(() => process.exit(0));
  });
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      runtime: "EvidenceForge deterministic control plane",
      trueForgeConfigured: Boolean(process.env.TRUEFORGE_BASE_URL && process.env.TRUEFORGE_MODEL),
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/events") {
    broker.connect(response);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/demo/session") {
    sendJson(response, 200, demo.snapshot());
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/demo/reset") {
    demo = new DemoWorkflow();
    const snapshot = demo.snapshot();
    broker.publish("demo-state", snapshot);
    sendJson(response, 200, snapshot);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/demo/advance") {
    const snapshot = demo.advance();
    broker.publish("demo-state", snapshot);
    sendJson(response, 200, snapshot);
    return;
  }
  const approvalMatch = /^\/api\/demo\/approvals\/([^/]+)$/.exec(url.pathname);
  if (request.method === "POST" && approvalMatch !== null) {
    const body = await readJson(request);
    const decision = readDecision(body);
    const snapshot = demo.decideApproval(decodeURIComponent(approvalMatch[1] ?? ""), decision);
    broker.publish("demo-state", snapshot);
    sendJson(response, 200, snapshot);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/live/start") {
    const state = await live.start((await readJson(request)) as unknown as StartLiveIncidentInput);
    sendJson(response, 201, state);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/live/resume") {
    const body = await readJson(request);
    const taskId = readString(body, "taskId");
    if (taskId === undefined) throw new Error("taskId is required");
    sendJson(response, 200, await live.resume(taskId));
    return;
  }
  const liveApprovalMatch = /^\/api\/live\/session\/([^/]+)\/approvals\/([^/]+)$/.exec(
    url.pathname,
  );
  if (request.method === "POST" && liveApprovalMatch !== null) {
    const body = await readJson(request);
    const decision = readDecision(body);
    const taskId = decodeURIComponent(liveApprovalMatch[1] ?? "");
    const approvalId = decodeURIComponent(liveApprovalMatch[2] ?? "");
    sendJson(response, 200, await live.decideApproval(taskId, approvalId, decision));
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/api/live/session/")) {
    const taskId = decodeURIComponent(url.pathname.slice("/api/live/session/".length));
    const state = await live.load(taskId);
    if (state === undefined) sendJson(response, 404, { error: "session not found" });
    else sendJson(response, 200, state);
    return;
  }
  if (request.method === "GET") {
    serveStatic(url.pathname, response);
    return;
  }
  sendJson(response, 404, { error: "not found" });
}

function serveStatic(pathname: string, response: ServerResponse): void {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(staticDirectory, safePath);
  if (!filePath.startsWith(staticDirectory) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(response, 404, { error: "not found" });
    return;
  }
  response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
  createReadStream(filePath).pipe(response);
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("JSON body must be an object");
  }
  return parsed as Record<string, unknown>;
}

function readDecision(body: Record<string, unknown>): "APPROVED" | "DENIED" {
  const value = body.decision;
  if (value !== "APPROVED" && value !== "DENIED") {
    throw new Error("decision must be APPROVED or DENIED");
  }
  return value;
}

function readString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(`${JSON.stringify(body)}\n`);
}
