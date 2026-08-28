import assert from "node:assert/strict";
import { test } from "node:test";
import { LiveIncidentService } from "../../apps/server/src/live-service";
import { SseBroker } from "../../apps/server/src/sse-broker";

type SerializedService = {
  serializeTask<T>(taskId: string, operation: () => Promise<T>): Promise<T>;
};

test("concurrent decisions for one task serialize to one external submission", async () => {
  const service = new LiveIncidentService(new SseBroker()) as unknown as SerializedService;
  let persistedDecision: "PENDING" | "APPROVED" = "PENDING";
  let submissions = 0;

  const decide = () =>
    service.serializeTask("task-race", async () => {
      if (persistedDecision !== "PENDING") throw new Error("approval is already decided");
      persistedDecision = "APPROVED";
      await Promise.resolve();
      submissions += 1;
      return "submitted";
    });

  const results = await Promise.allSettled([decide(), decide()]);

  assert.equal(submissions, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});
