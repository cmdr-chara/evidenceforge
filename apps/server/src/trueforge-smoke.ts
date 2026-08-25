import { loadTrueForgeConfig, TrueForgeSdkAdapter } from "../../../packages/trueforge/src";

async function main(): Promise<void> {
  const config = loadTrueForgeConfig();
  const healthUrl = new URL("/healthz", config.baseUrl);
  const health = await fetch(healthUrl, { headers: config.token ? { Authorization: `Bearer ${config.token}` } : {} });
  if (!health.ok) throw new Error(`TrueForge health check returned ${health.status}`);
  const adapter = new TrueForgeSdkAdapter(config);
  const sessionId = await adapter.createSession();
  process.stdout.write(`TrueForge session created: ${sessionId}\n`);
  const result = await adapter.runTurn({
    sessionId,
    message:
      "Return a concise readiness report. Confirm whether the GitHub MCP connector, Daytona sandbox, four EvidenceForge skills, dynamic subagents, and write approvals are available. Do not perform an external write.",
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        sessionId,
        turnId: result.turnId,
        events: result.events.length,
        paused: result.paused,
        lastSequenceNumber: result.lastSequenceNumber,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`TrueForge smoke BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
