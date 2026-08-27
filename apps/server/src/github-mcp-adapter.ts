import { PullRequestIdentity } from "../../../packages/domain/src";

/**
 * The official GitHub MCP server exposes ordinary GitHub API-shaped tools.
 * EvidenceForge keeps its control metadata in durable state and deliberately
 * never sends that metadata as an MCP argument.  In particular, these are
 * not accepted GitHub MCP fields: intent, artifactRef, expectedHeadSha,
 * operationId, and idempotencyKey.
 */
export const GITHUB_READ_ONLY_TOOLS = new Set([
  "get_commit",
  "get_file_contents",
  "pull_request_read",
  "issue_read",
  "list_issues",
  "list_pull_requests",
  "search_issues",
  "search_pull_requests",
]);

const CREATE_PULL_REQUEST_FIELDS = new Set([
  "owner",
  "repo",
  "title",
  "body",
  "head",
  "base",
  "draft",
  "maintainer_can_modify",
  "reviewers",
]);

const PULL_REQUEST_READ_FIELDS = new Set([
  "owner",
  "repo",
  "pullNumber",
  "pull_number",
  "method",
]);

export interface PreparedPullRequestEnvelope {
  repository: string;
  base: string;
  head: string;
  title: string;
  body: string;
  expectedHeadSha: string;
  operationId: string;
  idempotencyKey: string;
}

export interface OfficialCreatePullRequestArguments {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
  maintainer_can_modify?: boolean;
  reviewers?: string[];
}

export type CommitDetail = "none" | "stats" | "full_patch";

export interface OfficialGetCommitArguments {
  owner: string;
  repo: string;
  sha: string;
  detail?: CommitDetail;
  page?: number;
  perPage?: number;
}

export interface OfficialCommitRead {
  repository: string;
  sha: string;
}

export interface PullRequestReceipt {
  id: string;
  identifier: string;
  number: number;
  url: string;
}

export interface GitHubIncidentReadEnvelope {
  toolName: string;
  repository: string;
  revision: string;
  artifact: Record<string, unknown>;
}

/**
 * Return the actual MCP arguments that correspond to an application-owned
 * prepared action.  The expected SHA and operation metadata intentionally do
 * not appear in this object: they are application state, not GitHub MCP
 * parameters.
 */
export function officialArgumentsForPreparedPullRequest(
  prepared: PreparedPullRequestEnvelope,
): OfficialCreatePullRequestArguments {
  const { owner, repo } = splitRepository(prepared.repository);
  return {
    owner,
    repo,
    title: prepared.title,
    body: prepared.body,
    head: prepared.head,
    base: prepared.base,
  };
}

/**
 * Validate a model-issued create_pull_request call against a prepared action.
 * This function is intentionally strict about field names and exact values;
 * normalizing a model's prose or custom envelope would defeat the approval
 * boundary.
 */
export function validateCreatePullRequestCall(
  value: unknown,
  prepared: PreparedPullRequestEnvelope,
): OfficialCreatePullRequestArguments {
  const actual = parseCreatePullRequestArguments(value);
  const expected = officialArgumentsForPreparedPullRequest(prepared);
  for (const field of ["owner", "repo", "title", "body", "head", "base"] as const) {
    if (actual[field] !== expected[field]) {
      throw new Error(`GitHub create_pull_request ${field} does not match the prepared action`);
    }
  }

  return actual;
}

/** Parse and validate only the official create_pull_request request shape. */
export function parseCreatePullRequestArguments(
  value: unknown,
): OfficialCreatePullRequestArguments {
  const args = asRecord(value);
  const unsupported = Object.keys(args).filter((key) => !CREATE_PULL_REQUEST_FIELDS.has(key));
  if (unsupported.length > 0) {
    throw new Error(
      `GitHub create_pull_request contains unsupported application fields: ${unsupported.join(", ")}`,
    );
  }
  for (const field of ["owner", "repo", "title", "body", "head", "base"] as const) {
    if (readString(args, field) === undefined) {
      throw new Error(`GitHub create_pull_request is missing ${field}`);
    }
  }

  const draft = readOptionalBoolean(args, "draft");
  const maintainerCanModify = readOptionalBoolean(args, "maintainer_can_modify");
  const reviewers = readOptionalStringArray(args, "reviewers");
  if (args.draft !== undefined && draft === undefined) {
    throw new Error("GitHub create_pull_request draft must be a boolean");
  }
  if (args.maintainer_can_modify !== undefined && maintainerCanModify === undefined) {
    throw new Error("GitHub create_pull_request maintainer_can_modify must be a boolean");
  }
  if (args.reviewers !== undefined && reviewers === undefined) {
    throw new Error("GitHub create_pull_request reviewers must be an array of strings");
  }

  return {
    owner: readString(args, "owner") as string,
    repo: readString(args, "repo") as string,
    title: readString(args, "title") as string,
    body: readString(args, "body") as string,
    head: readString(args, "head") as string,
    base: readString(args, "base") as string,
    ...(draft === undefined ? {} : { draft }),
    ...(maintainerCanModify === undefined ? {} : { maintainer_can_modify: maintainerCanModify }),
    ...(reviewers === undefined ? {} : { reviewers }),
  };
}

/**
 * Parse an official get_commit response for an application-owned branch
 * subject. This is separate from incident evidence: the caller must still
 * bind the request's owner/repo and requested sha/branch before using it.
 */
export function parseGetCommitResult(
  value: unknown,
  expectedRepository: string,
): OfficialCommitRead {
  const result = unwrapResult(value);
  if (isFailureResult(result)) throw new Error("GitHub get_commit returned a failure");
  const sha = explicitCommitSha(result);
  const repository = readString(result, "repository") ??
    repositoryFromNested(result.repository) ??
    repositoryFromNested(result.commit) ??
    repositoryFromNested(result.committer);
  if (sha === undefined || !/^[a-f0-9]{7,64}$/i.test(sha)) {
    throw new Error("GitHub get_commit response lacks a valid commit SHA");
  }
  if (repository !== undefined && repository !== expectedRepository) {
    throw new Error("GitHub get_commit response repository does not match the task");
  }
  return { repository: expectedRepository, sha };
}

/** Validate a get_commit request without treating its branch/ref as incident evidence. */
export function validateHeadCommitCall(
  value: unknown,
  expectedRepository: string,
): OfficialGetCommitArguments {
  const args = asRecord(value);
  const allowed = new Set(["owner", "repo", "sha", "detail", "page", "perPage"]);
  const unsupported = Object.keys(args).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) {
    throw new Error(`GitHub get_commit contains unsupported application fields: ${unsupported.join(", ")}`);
  }
  const { owner, repo } = splitRepository(expectedRepository);
  const sha = readString(args, "sha");
  if (readString(args, "owner") !== owner || readString(args, "repo") !== repo) {
    throw new Error("GitHub get_commit repository does not match the task");
  }
  if (sha === undefined || sha.trim().length === 0) {
    throw new Error("GitHub get_commit requires a branch or commit sha");
  }
  const detail = readOptionalCommitDetail(args, "detail");
  if (args.detail !== undefined && detail === undefined) {
    throw new Error("GitHub get_commit detail must be one of none, stats, or full_patch");
  }
  const page = readOptionalPage(args, "page");
  if (args.page !== undefined && page === undefined) {
    throw new Error("GitHub get_commit page must be an integer greater than or equal to 1");
  }
  const perPage = readOptionalPerPage(args, "perPage");
  if (args.perPage !== undefined && perPage === undefined) {
    throw new Error("GitHub get_commit perPage must be an integer between 1 and 100");
  }
  return {
    owner,
    repo,
    sha,
    ...(detail === undefined ? {} : { detail }),
    ...(page === undefined ? {} : { page }),
    ...(perPage === undefined ? {} : { perPage }),
  };
}

/**
 * Parse the minimal official create response ({ id, url }).  No identity or
 * control metadata is accepted from this response.  The URL is used only to
 * derive the pull-request number and must point at the prepared repository.
 */
export function parseCreatePullRequestResult(
  value: unknown,
  expectedRepository: string,
): PullRequestReceipt {
  const result = unwrapResult(value);
  if (isFailureResult(result)) throw new Error("GitHub create_pull_request returned a failure");

  const rawId = result.id;
  const id = typeof rawId === "string" || typeof rawId === "number"
    ? String(rawId)
    : undefined;
  const url = readString(result, "url") ?? readString(result, "html_url");
  if (id === undefined || url === undefined) {
    throw new Error("GitHub create_pull_request response must contain id and url");
  }

  const parsedUrl = parseGitHubPullRequestUrl(url, expectedRepository);
  const rawNumber = readNumber(result, "number");
  const number = parsedUrl.number ?? rawNumber;
  if (number === undefined || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error("GitHub create_pull_request response does not identify a pull-request number");
  }
  if (parsedUrl.number !== undefined && rawNumber !== undefined && parsedUrl.number !== rawNumber) {
    throw new Error("GitHub create_pull_request response has conflicting pull-request numbers");
  }
  return { id, identifier: `#${number}`, number, url };
}

/**
 * Validate an official pull_request_read call against the receipt returned by
 * create_pull_request.  The read is a separate required reconciliation step;
 * a create response alone can never produce a PullRequestIdentity.
 */
export function validatePullRequestReadCall(
  value: unknown,
  expectedRepository: string,
  receipt: PullRequestReceipt,
): { owner: string; repo: string; pullNumber: number; method?: string } {
  const args = asRecord(value);
  const unsupported = Object.keys(args).filter((key) => !PULL_REQUEST_READ_FIELDS.has(key));
  if (unsupported.length > 0) {
    throw new Error(
      `GitHub pull_request_read contains unsupported application fields: ${unsupported.join(", ")}`,
    );
  }
  const { owner, repo } = splitRepository(expectedRepository);
  if (readString(args, "owner") !== owner || readString(args, "repo") !== repo) {
    throw new Error("GitHub pull_request_read repository does not match the prepared action");
  }
  const pullNumber = readNumber(args, "pullNumber") ?? readNumber(args, "pull_number");
  if (pullNumber === undefined || !Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
    throw new Error("GitHub pull_request_read requires a valid pullNumber");
  }
  if (pullNumber !== receipt.number) {
    throw new Error("GitHub pull_request_read pullNumber does not match the created pull request");
  }
  const method = readString(args, "method");
  if (method !== undefined && method !== "get") {
    throw new Error("GitHub pull_request_read reconciliation requires method=get");
  }
  return { owner, repo, pullNumber, ...(method === undefined ? {} : { method }) };
}

/**
 * Parse the authoritative pull-request shape returned by pull_request_read.
 * operationId and idempotencyKey are filled from the durable prepared action;
 * fields with those names in an MCP response are ignored, never trusted.
 */
export function parsePullRequestReadResult(
  value: unknown,
  prepared: PreparedPullRequestEnvelope,
  receipt: PullRequestReceipt,
): PullRequestIdentity {
  const result = unwrapResult(value);
  if (isFailureResult(result)) throw new Error("GitHub pull_request_read returned a failure");
  const candidate = findPullRequestRecord(result);
  if (candidate === undefined) {
    throw new Error("GitHub pull_request_read response lacks structured head and base data");
  }

  const repository = readPullRequestRepository(candidate);
  const baseRecord = asRecord(candidate.base);
  const headRecord = asRecord(candidate.head);
  const base = readString(baseRecord, "ref");
  const head = readString(headRecord, "ref");
  const headSha = readString(headRecord, "sha") ?? readString(headRecord, "headSha");
  if (repository !== prepared.repository) {
    throw new Error("GitHub pull_request_read repository does not match the prepared action");
  }
  if (base !== prepared.base || head !== prepared.head) {
    throw new Error("GitHub pull_request_read base or head does not match the prepared action");
  }
  if (headSha !== prepared.expectedHeadSha) {
    throw new Error("GitHub pull_request_read head SHA does not match the prepared action");
  }

  const number = readNumber(candidate, "number") ??
    parsePullNumber(readString(candidate, "url") ?? readString(candidate, "html_url"));
  if (number !== undefined && number !== receipt.number) {
    throw new Error("GitHub pull_request_read response identifies a different pull request");
  }
  return {
    identifier: receipt.identifier,
    repository,
    base,
    head,
    headSha,
    // These two values are application-owned and intentionally not read from
    // the untrusted connector response.
    operationId: prepared.operationId,
    idempotencyKey: prepared.idempotencyKey,
  };
}

/**
 * Accept only known read-only GitHub MCP tools and bind their request/result
 * to the incident repository and revision.  The returned artifact is an
 * application-owned envelope; artifactRef is generated by the caller and is
 * never sent to GitHub.
 */
export function validateIncidentRead(
  toolName: string,
  argumentsValue: unknown,
  resultValue: unknown,
  expectedRepository: string,
  expectedRevision: string,
): GitHubIncidentReadEnvelope {
  if (!GITHUB_READ_ONLY_TOOLS.has(toolName)) {
    throw new Error(`GitHub MCP tool ${toolName} is not an admissible read-only incident tool`);
  }
  const args = asRecord(argumentsValue);
  rejectControlFields(args, `GitHub ${toolName}`);
  const repository = repositoryFromArguments(toolName, args, expectedRepository);
  const result = unwrapResult(resultValue);
  if (isFailureResult(result)) throw new Error(`GitHub ${toolName} returned a failure`);
  if (!resultHasRevision(toolName, args, result, expectedRepository, expectedRevision)) {
    throw new Error(`GitHub ${toolName} is not bound to incident revision ${expectedRevision}`);
  }
  return {
    toolName,
    repository,
    revision: expectedRevision,
    artifact: structuredClone(result),
  };
}

export function isGitHubReadOnlyTool(name: string): boolean {
  return GITHUB_READ_ONLY_TOOLS.has(name);
}

/** Exposed for focused tests and the live reducer's response parser. */
export function unwrapMcpResult(value: unknown): Record<string, unknown> {
  return unwrapResult(value);
}

function repositoryFromArguments(
  toolName: string,
  args: Record<string, unknown>,
  expectedRepository: string,
): string {
  const explicit = readString(args, "owner") !== undefined || readString(args, "repo") !== undefined;
  if (explicit) {
    const owner = readString(args, "owner");
    const repo = readString(args, "repo");
    const actual = owner !== undefined && repo !== undefined ? `${owner}/${repo}` : undefined;
    if (actual !== expectedRepository) {
      throw new Error(`GitHub ${toolName} repository does not match the incident task`);
    }
    return expectedRepository;
  }

  const query = readString(args, "q") ?? readString(args, "query");
  if (query === undefined || !queryIncludesRepository(query, expectedRepository)) {
    throw new Error(`GitHub ${toolName} query is not bound to the incident repository`);
  }
  return expectedRepository;
}

function resultHasRevision(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  expectedRepository: string,
  revision: string,
): boolean {
  if (toolName === "get_commit") {
    return (readString(args, "sha") ?? readString(args, "ref")) === revision &&
      explicitCommitSha(result) === revision;
  }
  if (toolName === "get_file_contents") {
    return fileContentsRequestIsBound(args, revision) &&
      hasStructuredFileContents(result, expectedRepository, revision);
  }
  // These tools do not take a revision argument.  Only inspect the
  // tool-specific, authoritative fields below; never recurse through titles,
  // bodies, comments, URLs, or arbitrary connector prose looking for a SHA.
  return explicitSemanticRevision(toolName, args, result) === revision;
}

function explicitCommitSha(result: Record<string, unknown>): string | undefined {
  for (const payload of structuredPayloads(result)) {
    const record = asRecord(payload);
    const sha = readString(record, "sha") ?? readString(asRecord(record.commit), "sha");
    if (sha !== undefined && /^[a-f0-9]{7,64}$/i.test(sha)) return sha;
  }
  return undefined;
}

function fileContentsRequestIsBound(args: Record<string, unknown>, revision: string): boolean {
  // The current official server accepts either `sha` or `ref` and gives `sha`
  // precedence when both are supplied.  A branch/tag ref alone is not an
  // authoritative commit binding, so incident evidence must request the
  // exact failing commit explicitly.  `ref` is accepted only when it is the
  // exact revision as well (some older servers exposed that spelling).
  const sha = readString(args, "sha");
  const ref = readString(args, "ref");
  return sha === revision || (sha === undefined && ref === revision);
}

function hasStructuredFileContents(
  result: Record<string, unknown>,
  expectedRepository: string,
  revision: string,
): boolean {
  if (hasVerifiedFileContentsEnvelope(result, expectedRepository, revision)) return true;
  const payloads = structuredPayloads(result);
  for (const payload of payloads) {
    if (isOfficialFileResource(payload, expectedRepository, revision)) return true;
  }
  return false;
}

function hasVerifiedFileContentsEnvelope(
  result: Record<string, unknown>,
  expectedRepository: string,
  revision: string,
): boolean {
  const repository = readString(result, "repository");
  const responseRevision = readString(result, "revision") ??
    readString(result, "commitSha") ??
    readString(result, "sha");
  const artifact = result.artifact;
  return repository === expectedRepository &&
    responseRevision === revision &&
    (isFileArtifactData(artifact) || isDirectoryArtifact(artifact));
}

function isOfficialFileResource(value: unknown, expectedRepository: string, revision: string): boolean {
  const record = asRecord(value);
  const resource = readResource(value);
  if (resource === undefined) return false;
  const uri = readString(resource, "uri");
  const hasContent = typeof resource.text === "string" || typeof resource.blob === "string";
  return uri !== undefined && hasContent && resourceUriIsBound(uri, expectedRepository, revision);
}

function isFileArtifactData(value: unknown): boolean {
  const record = asRecord(value);
  if (readString(record, "type") !== "file") return false;
  const path = readString(record, "path") ?? readString(record, "name");
  const content = record.content;
  const blob = record.blob;
  const sha = readString(record, "sha");
  return path !== undefined &&
    sha !== undefined &&
    /^[a-f0-9]{7,64}$/i.test(sha) &&
    (typeof content === "string" || typeof blob === "string");
}

function isDirectoryArtifact(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => {
    const record = asRecord(entry);
    const type = readString(record, "type");
    const path = readString(record, "path") ?? readString(record, "name");
    return path !== undefined &&
      (type === "file" || type === "dir" || type === "symlink" || type === "submodule");
  });
}

function readResource(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (readString(record, "type") !== "resource") return undefined;
  const resource = asRecord(record.resource);
  return Object.keys(resource).length === 0 ? undefined : resource;
}

function resourceUriIsBound(uri: string, expectedRepository: string, revision: string): boolean {
  // The official server emits repo://.../sha/<commit>/contents/... for an
  // exact SHA request.  Do not accept a branch/tag URI for revision evidence.
  const [owner, repo] = expectedRepository.split("/");
  const match = uri.match(/^repo:\/\/([^/]+)\/([^/]+)\/sha\/([^/]+)\/contents(?:\/|$)/);
  return match?.[1] === owner && match?.[2] === repo && match?.[3] === revision;
}

function explicitSemanticRevision(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
): string | undefined {
  const method = readString(args, "method");
  switch (toolName) {
    case "pull_request_read":
      // `get` is the only pull-request read that directly exposes the PR head
      // ref.  Status/commit variants may expose a commit SHA in their own
      // documented top-level/commit records; comments, diffs, and files do
      // not identify the checked-out revision and therefore fail closed.
      if (method === undefined || method === "get") {
        return firstExplicitSha(result, (record) => readString(asRecord(record.head), "sha"));
      }
      if (method === "get_status") return firstExplicitSha(result, (record) => readString(record, "sha"));
      if (method === "get_commits") return firstExplicitSha(result, (record) => readString(record, "sha"));
      return undefined;
    case "list_pull_requests":
      return firstExplicitShaFromCollection(result, (record) => readString(asRecord(record.head), "sha"));
    case "search_pull_requests":
      return firstExplicitShaFromCollection(result, (record) =>
        readString(asRecord(record.head), "sha") ??
        readString(asRecord(asRecord(record.pull_request).head), "sha"));
    case "issue_read":
      return firstExplicitSha(result, (record) =>
        readString(asRecord(record.commit), "sha") ??
        readString(asRecord(asRecord(record.pull_request).head), "sha"));
    case "list_issues":
    case "search_issues":
      return firstExplicitShaFromCollection(result, (record) =>
        readString(asRecord(record.commit), "sha") ??
        readString(asRecord(asRecord(record.pull_request).head), "sha"));
    default:
      return undefined;
  }
}

function firstExplicitSha(
  result: Record<string, unknown>,
  read: (record: Record<string, unknown>) => string | undefined,
): string | undefined {
  for (const payload of structuredPayloads(result)) {
    const record = asRecord(payload);
    const sha = read(record);
    if (sha !== undefined && /^[a-f0-9]{7,64}$/i.test(sha)) return sha;
  }
  return undefined;
}

function firstExplicitShaFromCollection(
  result: Record<string, unknown>,
  read: (record: Record<string, unknown>) => string | undefined,
): string | undefined {
  for (const payload of structuredPayloads(result)) {
    const records = Array.isArray(payload)
      ? payload
      : [
          ...asArray(asRecord(payload).items),
          ...asArray(asRecord(payload).issues),
          ...asArray(asRecord(payload).pullRequests),
          ...asArray(asRecord(payload).pull_requests),
        ];
    for (const item of records) {
      const sha = read(asRecord(item));
      if (sha !== undefined && /^[a-f0-9]{7,64}$/i.test(sha)) return sha;
    }
  }
  return undefined;
}

function structuredPayloads(result: Record<string, unknown>): unknown[] {
  const payloads: unknown[] = [result];
  const content = result.content;
  if (!Array.isArray(content)) return payloads;
  for (const block of content) {
    const blockRecord = asRecord(block);
    if (readString(blockRecord, "type") === "text") {
      const parsed = parseStructuredJson(blockRecord.text);
      if (parsed !== undefined) payloads.push(parsed);
    } else if (readString(blockRecord, "type") === "resource") {
      const resource = asRecord(blockRecord.resource);
      if (Object.keys(resource).length > 0) payloads.push(blockRecord);
    } else if (readString(blockRecord, "type") === "resource_link") {
      payloads.push(blockRecord);
    }
  }
  return payloads;
}

function parseStructuredJson(value: unknown): unknown | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) || Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rejectControlFields(args: Record<string, unknown>, label: string): void {
  const forbidden = [
    "intent",
    "artifactRef",
    "expectedHeadSha",
    "operationId",
    "idempotencyKey",
  ].filter((key) => args[key] !== undefined);
  if (forbidden.length > 0) {
    throw new Error(`${label} contains application-only fields: ${forbidden.join(", ")}`);
  }
}

function queryIncludesRepository(query: string, repository: string): boolean {
  const normalized = query.toLowerCase().replace(/[\s,]+/g, " ");
  return normalized.includes(`repo:${repository.toLowerCase()}`);
}

function findPullRequestRecord(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const base = asRecord(value.base);
  const head = asRecord(value.head);
  if (Object.keys(base).length > 0 && Object.keys(head).length > 0) return value;
  for (const child of Object.values(value)) {
    if (!isRecord(child)) continue;
    const nested = findPullRequestRecord(child);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function readPullRequestRepository(value: Record<string, unknown>): string | undefined {
  const headRepository = repositoryFromNested(value.head);
  const baseRepository = repositoryFromNested(value.base);
  if (headRepository !== undefined && baseRepository !== undefined && headRepository !== baseRepository) {
    throw new Error("GitHub pull_request_read has conflicting head and base repositories");
  }
  return headRepository ?? baseRepository ??
    readString(value, "repository") ?? repositoryFromNested(value.repository);
}

function repositoryFromNested(value: unknown): string | undefined {
  const record = asRecord(value);
  return readString(record, "full_name") ??
    readString(record, "fullName") ??
    readString(asRecord(record.repo), "full_name") ??
    readString(asRecord(record.repo), "fullName");
}

function parseGitHubPullRequestUrl(
  value: string,
  expectedRepository: string,
): { number?: number } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("GitHub pull-request URL is malformed");
  }
  if (url.hostname !== "github.com" && url.hostname !== "api.github.com") {
    throw new Error("GitHub pull-request URL has an unexpected host");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const expected = expectedRepository.split("/");
  const match =
    segments.length >= 4 && segments[0] === expected[0] && segments[1] === expected[1] && segments[2] === "pull"
      ? segments[3]
      : segments.length >= 5 && segments[0] === "repos" && segments[1] === expected[0] && segments[2] === expected[1] && segments[3] === "pulls"
        ? segments[4]
        : undefined;
  if (match === undefined || !/^\d+$/.test(match)) {
    throw new Error("GitHub pull-request URL does not point to the prepared repository");
  }
  return { number: Number(match) };
}

function parsePullNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = value.match(/(?:\/pull\/|\/pulls\/)(\d+)(?:[/?#]|$)/);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function unwrapResult(value: unknown): Record<string, unknown> {
  const parsed = parseJsonIfString(value);
  const root = asRecord(parsed);
  if (Object.keys(root).length === 0) return root;
  if (isFailureResult(root)) return root;
  const response = asRecord(root.response);
  if (Object.keys(response).length > 0) return unwrapResult(response);
  const output = asRecord(root.output);
  const outputResult = asRecord(output.result);
  if (Object.keys(outputResult).length > 0) return unwrapResult(outputResult);
  const result = asRecord(root.result);
  if (Object.keys(result).length > 0) return unwrapResult(result);
  return root;
}

function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function isFailureResult(value: Record<string, unknown>): boolean {
  if (value.success === false) return true;
  const status = readString(value, "status")?.toUpperCase();
  return status === "ERROR" || status === "FAILED" || status === "FAILURE" || status === "DENIED" || status === "TIMEOUT";
}

function splitRepository(repository: string): { owner: string; repo: string } {
  const match = repository.match(/^([^/]+)\/([^/]+)$/);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error("GitHub repository must be owner/name");
  }
  return { owner: match[1], repo: match[2] };
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return value === undefined ? undefined : typeof value === "boolean" ? value : undefined;
}

function readOptionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  return value === undefined
    ? undefined
    : Array.isArray(value) && value.every((item) => typeof item === "string")
      ? [...value]
      : undefined;
}

function readOptionalCommitDetail(record: Record<string, unknown>, key: string): CommitDetail | undefined {
  const value = record[key];
  return value === "none" || value === "stats" || value === "full_patch" ? value : undefined;
}

function readOptionalPage(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return isSafePositiveInteger(value) ? value : undefined;
}

function readOptionalPerPage(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return isSafePositiveInteger(value) && value <= 100 ? value : undefined;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
