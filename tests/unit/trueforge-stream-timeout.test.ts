import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consumeMetadataStream,
  replayListedTurnEvents,
  TrueForgeStreamTimeoutError,
} from "../../packages/trueforge/src";

test("TrueForge metadata streams have an absolute deadline even while events keep arriving", async () => {
  let closed = false;
  const stream = {
    withMetadata(): AsyncIterable<{ data: unknown; id?: string }> {
      return {
        [Symbol.asyncIterator]() {
          let sequence = 0;
          return {
            async next() {
              await new Promise((resolve) => setTimeout(resolve, 2));
              sequence += 1;
              return {
                done: false as const,
                value: {
                  id: String(sequence),
                  data: { type: "message.delta", id: `delta-${sequence}` },
                },
              };
            },
            async return() {
              closed = true;
              return { done: true as const, value: undefined };
            },
          };
        },
      };
    },
  };

  await assert.rejects(
    consumeMetadataStream({
      sessionId: "session-timeout",
      stream,
      timeoutInSeconds: 0.03,
    }),
    TrueForgeStreamTimeoutError,
  );
  assert.equal(closed, true);
});

test("TrueForge metadata stream deadline also bounds a suspended event callback", async () => {
  let closed = false;
  const stream = singleItemStream(() => {
    closed = true;
  });

  await assert.rejects(
    consumeMetadataStream({
      sessionId: "session-callback-timeout",
      stream,
      timeoutInSeconds: 0.03,
      onEvent: () => new Promise(() => undefined),
    }),
    TrueForgeStreamTimeoutError,
  );
  assert.equal(closed, true);
});

test("completed-turn replay has the same absolute deadline and closes its iterator", async () => {
  let closed = false;
  const events = singleItemIterable(() => {
    closed = true;
  });

  await assert.rejects(
    replayListedTurnEvents(
      events,
      0,
      () => new Promise(() => undefined),
      0.03,
    ),
    TrueForgeStreamTimeoutError,
  );
  assert.equal(closed, true);
});

function singleItemStream(onClose: () => void) {
  return {
    withMetadata() {
      return singleItemIterable(onClose, {
        id: "1",
        data: { type: "message.delta", id: "delta-callback" },
      });
    },
  };
}

function singleItemIterable<T = unknown>(onClose: () => void, value?: T): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let emitted = false;
      return {
        async next() {
          if (emitted) return new Promise<IteratorResult<T>>(() => undefined);
          emitted = true;
          return { done: false as const, value: value as T };
        },
        async return() {
          onClose();
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}
