import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

interface StreamEvent {
  data: string;
}

type StreamListener = (event: StreamEvent) => void;

class FakeEventSource {
  public static readonly instances: FakeEventSource[] = [];
  public readonly listeners = new Map<string, StreamListener[]>();
  public closed = false;

  public constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  public addEventListener(name: string, listener: StreamListener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public close(): void {
    this.closed = true;
  }

  public emit(name: string, data: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

interface StreamSnapshot {
  mode: "LIVE_TRUEFORGE" | "DETERMINISTIC_FIXTURE";
  taskId: string | null;
  activity: readonly unknown[];
}

interface AppBridge {
  render(input: unknown): void;
  getStreamSnapshot(): StreamSnapshot;
  appendRuntimeActivity(input: unknown, expectedTaskId: string): boolean;
  showConnection(text: string, variant: string): void;
}

test("scoped stream routes incremental activity through the task-bound app bridge", () => {
  FakeEventSource.instances.length = 0;
  const callbacks = new Map<string, () => void>();
  const rendered: unknown[] = [];
  const appended: Array<{ input: unknown; taskId: string }> = [];
  let currentTaskId: string | null = "task-one";
  const app: AppBridge = {
    render(input) {
      rendered.push(input);
      if (
        typeof input === "object"
        && input !== null
        && "mode" in input
        && input.mode === "DETERMINISTIC_FIXTURE"
      ) currentTaskId = null;
      else if (
        typeof input === "object"
        && input !== null
        && "task" in input
        && typeof input.task === "object"
        && input.task !== null
        && "id" in input.task
        && typeof input.task.id === "string"
      ) currentTaskId = input.task.id;
    },
    getStreamSnapshot() {
      return {
        mode: currentTaskId === null ? "DETERMINISTIC_FIXTURE" : "LIVE_TRUEFORGE",
        taskId: currentTaskId,
        activity: [],
      };
    },
    appendRuntimeActivity(input, expectedTaskId) {
      if (expectedTaskId !== currentTaskId) return false;
      appended.push({ input, taskId: expectedTaskId });
      return true;
    },
    showConnection() {},
  };
  const windowObject = {
    EventSource: FakeEventSource,
    evidenceForge: app,
    location: { href: "http://localhost:4173/" },
    addEventListener(name: string, callback: () => void) {
      callbacks.set(name, callback);
    },
  };
  const documentObject = {
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const source = readFileSync(resolve(process.cwd(), "apps/web/public/stream-scope.js"), "utf8");

  runInNewContext(source, {
    URL,
    document: documentObject,
    window: windowObject,
  });

  const bootstrap = new windowObject.EventSource("/api/events");
  callbacks.get("DOMContentLoaded")?.();
  assert.equal(bootstrap.closed, true);
  assert.equal(FakeEventSource.instances.length, 2);

  const taskOneSource = FakeEventSource.instances[1];
  assert.ok(taskOneSource);
  assert.equal(taskOneSource.url, "/api/events");

  currentTaskId = "task-one";
  app.render({ mode: "LIVE_TRUEFORGE", task: { id: "task-one" } });
  const taskOneLiveSource = FakeEventSource.instances[2];
  assert.ok(taskOneLiveSource);
  assert.equal(taskOneLiveSource.url, "/api/events?task=task-one");
  taskOneLiveSource.emit("runtime-event", { id: "event-one", source: "trueforge:thread.created" });
  assert.deepEqual(JSON.parse(JSON.stringify(appended)), [{
    input: { id: "event-one", source: "trueforge:thread.created" },
    taskId: "task-one",
  }]);

  currentTaskId = null;
  app.render({ mode: "DETERMINISTIC_FIXTURE", task: { id: "fixture" } });
  const fixtureSource = FakeEventSource.instances[3];
  assert.ok(fixtureSource);
  assert.equal(fixtureSource.url, "/api/events");
  assert.equal(taskOneLiveSource.closed, true);

  currentTaskId = "task-two";
  app.render({ mode: "LIVE_TRUEFORGE", task: { id: "task-two" } });
  const taskTwoSource = FakeEventSource.instances[4];
  assert.ok(taskTwoSource);
  assert.equal(taskTwoSource.url, "/api/events?task=task-two");
  taskOneLiveSource.emit("runtime-event", { id: "stale-event", source: "trueforge:thread.created" });
  taskTwoSource.emit("runtime-event", { id: "event-two", source: "trueforge:thread.done" });
  assert.deepEqual(JSON.parse(JSON.stringify(appended)), [
    {
      input: { id: "event-one", source: "trueforge:thread.created" },
      taskId: "task-one",
    },
    {
      input: { id: "event-two", source: "trueforge:thread.done" },
      taskId: "task-two",
    },
  ]);

  assert.equal(rendered.length, 3);
});

test("scoped stream does not expose or depend on lexical app state globals", () => {
  const source = readFileSync(resolve(process.cwd(), "apps/web/public/stream-scope.js"), "utf8");
  assert.doesNotMatch(source, /window\.state/);
  assert.doesNotMatch(source, /window\.normalizeActivity/);
  assert.doesNotMatch(source, /window\.renderActivity/);
  assert.match(source, /getStreamSnapshot/);
  assert.match(source, /appendRuntimeActivity/);
});

test("static Pages showcase never opens an API event stream", () => {
  FakeEventSource.instances.length = 0;
  const callbacks = new Map<string, () => void>();
  const rendered: unknown[] = [];
  const app: AppBridge = {
    render(input) {
      rendered.push(input);
    },
    getStreamSnapshot() {
      return { mode: "DETERMINISTIC_FIXTURE", taskId: null, activity: [] };
    },
    appendRuntimeActivity() {
      return false;
    },
    showConnection() {},
  };
  const windowObject = {
    EventSource: FakeEventSource,
    evidenceForge: app,
    location: { href: "https://cmdr-chara.github.io/evidenceforge/" },
    addEventListener(name: string, callback: () => void) {
      callbacks.set(name, callback);
    },
  };
  const documentObject = {
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const source = readFileSync(resolve(process.cwd(), "apps/web/public/stream-scope.js"), "utf8");

  runInNewContext(source, {
    URL,
    document: documentObject,
    window: windowObject,
  });

  callbacks.get("DOMContentLoaded")?.();
  app.render({ mode: "DETERMINISTIC_FIXTURE", task: { id: "fixture" } });
  assert.equal(FakeEventSource.instances.length, 0);
  assert.equal(rendered.length, 1);
});

test("bootstrap stream is scoped and rejects cross-task snapshots before DOMContentLoaded", () => {
  FakeEventSource.instances.length = 0;
  const callbacks = new Map<string, () => void>();
  const received: unknown[] = [];
  const windowObject = {
    EventSource: FakeEventSource,
    location: { href: "http://localhost:4173/?task=task-two" },
    addEventListener(name: string, callback: () => void) {
      callbacks.set(name, callback);
    },
  };
  const documentObject = {
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const source = readFileSync(resolve(process.cwd(), "apps/web/public/stream-scope.js"), "utf8");

  runInNewContext(source, {
    URL,
    document: documentObject,
    window: windowObject,
  });

  const bootstrap = new windowObject.EventSource("/api/events");
  const handler = (event: StreamEvent) => received.push(JSON.parse(event.data));
  bootstrap.addEventListener("live-state", handler);
  bootstrap.emit("live-state", { task: { id: "task-one" } });
  assert.deepEqual(received, []);

  bootstrap.emit("live-state", { task: { id: "task-two" } });
  assert.deepEqual(received, [{ task: { id: "task-two" } }]);
  assert.equal(bootstrap.url, "/api/events?task=task-two");

  callbacks.get("DOMContentLoaded")?.();
  assert.equal(bootstrap.closed, true);
});
