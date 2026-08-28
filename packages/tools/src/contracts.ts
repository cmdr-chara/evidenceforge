export interface GetIncidentContextInput {
  repository: string;
  runId: string;
}

export interface IncidentContext {
  commitSha: string;
  branch: string;
  workflow: string;
  failedJobs: Array<{ id: string; name: string; conclusion: string }>;
  annotations: string[];
  logArtifactRefs: string[];
  relatedPullRequest?: string;
}

export interface SearchLogsInput {
  artifactRef: string;
  query: string;
  maxMatches: number;
  contextLines: number;
}

export interface SearchLogsResult {
  matches: Array<{ line: number; excerpt: string }>;
  truncated: boolean;
}

export interface SearchRepositoryInput {
  query: string;
  paths?: string[];
  maxResults: number;
}

export interface SearchRepositoryResult {
  results: Array<{ path: string; line: number; excerpt: string }>;
  truncated: boolean;
}

export function validateSearchLogsInput(input: SearchLogsInput): SearchLogsInput {
  if (input.query.trim().length === 0) throw new Error("log query cannot be empty");
  if (!Number.isInteger(input.maxMatches) || input.maxMatches < 1 || input.maxMatches > 20) {
    throw new Error("maxMatches must be between 1 and 20");
  }
  if (!Number.isInteger(input.contextLines) || input.contextLines < 0 || input.contextLines > 5) {
    throw new Error("contextLines must be between 0 and 5");
  }
  return input;
}

export function validateSearchRepositoryInput(input: SearchRepositoryInput): SearchRepositoryInput {
  if (input.query.trim().length === 0) throw new Error("repository query cannot be empty");
  if (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 20) {
    throw new Error("maxResults must be between 1 and 20");
  }
  return input;
}
