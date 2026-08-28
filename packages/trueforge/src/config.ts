export interface TrueForgeRuntimeConfig {
  baseUrl: string;
  token?: string;
  model: string;
  githubMcpName: string;
  timeoutInSeconds: number;
}

export function loadTrueForgeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): TrueForgeRuntimeConfig {
  return {
    baseUrl: environment.TRUEFORGE_BASE_URL ?? "http://localhost:8790",
    token: nonEmpty(environment.TRUEFORGE_TOKEN),
    model: environment.TRUEFORGE_MODEL ?? "openai/gpt-5.2",
    githubMcpName: environment.TRUEFORGE_GITHUB_MCP_NAME ?? "github",
    timeoutInSeconds: parsePositiveInt(environment.TRUEFORGE_TIMEOUT_SECONDS, 600),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
