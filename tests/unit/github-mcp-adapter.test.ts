import assert from "node:assert/strict";
import { test } from "node:test";
import {
  officialArgumentsForPreparedPullRequest,
  parseCreatePullRequestArguments,
  parseCreatePullRequestResult,
  parseGetCommitResult,
  parsePullRequestReadResult,
  validateCreatePullRequestCall,
  validateHeadCommitCall,
  validateIncidentRead,
  validatePullRequestReadCall,
} from "../../apps/server/src/github-mcp-adapter";

const prepared = {
  repository: "cmdr-chara/evidenceforge",
  base: "determination",
  head: "feat/foundation-control-plane",
  title: "fix: enforce completion evidence",
  body: "Evidence-backed remediation.",
  expectedHeadSha: "abcdef1234567",
  operationId: "operation-pr-1",
  idempotencyKey: "idempotency-pr-1",
};

assert.notEqual(prepared.operationId, prepared.idempotencyKey);

test("GitHub adapter emits only the official create_pull_request schema", () => {
  assert.deepEqual(officialArgumentsForPreparedPullRequest(prepared), {
    owner: "cmdr-chara",
    repo: "evidenceforge",
    title: prepared.title,
    body: prepared.body,
    head: prepared.head,
    base: prepared.base,
  });
  assert.throws(
    () =>
      validateCreatePullRequestCall(
        {
          ...officialArgumentsForPreparedPullRequest(prepared),
          intent: "evidenceforge.external-reconcile",
          artifactRef: "artifact://forged",
        },
        prepared,
      ),
    /unsupported application fields/,
  );
});

test("GitHub adapter rejects a create call with the wrong repository or branch", () => {
  const official = officialArgumentsForPreparedPullRequest(prepared);
  assert.throws(
    () => validateCreatePullRequestCall({ ...official, repo: "other-repository" }, prepared),
    /repo does not match/,
  );
  assert.throws(
    () => validateCreatePullRequestCall({ ...official, head: "attacker-branch" }, prepared),
    /head does not match/,
  );
  assert.throws(
    () => validateCreatePullRequestCall({ ...official, expectedHeadSha: prepared.expectedHeadSha }, prepared),
    /unsupported application fields/,
  );
});

test("post-patch head SHA comes from a repository read, never from create arguments", () => {
  assert.deepEqual(
    validateHeadCommitCall(
      {
        owner: "cmdr-chara",
        repo: "evidenceforge",
        sha: "feat/foundation-control-plane",
        detail: "full_patch",
        page: 1,
        perPage: 100,
      },
      prepared.repository,
    ),
    {
      owner: "cmdr-chara",
      repo: "evidenceforge",
      sha: "feat/foundation-control-plane",
      detail: "full_patch",
      page: 1,
      perPage: 100,
    },
  );
  assert.deepEqual(
    parseGetCommitResult(
      {
        success: true,
        response: {
          sha: prepared.expectedHeadSha,
          repository: prepared.repository,
        },
      },
      prepared.repository,
    ),
    { repository: prepared.repository, sha: prepared.expectedHeadSha },
  );
  assert.deepEqual(
    parseCreatePullRequestArguments(officialArgumentsForPreparedPullRequest(prepared)),
    officialArgumentsForPreparedPullRequest(prepared),
  );
});

test("get_commit optional fields are official and strictly typed", () => {
  const base = { owner: "cmdr-chara", repo: "evidenceforge", sha: prepared.head };
  assert.deepEqual(validateHeadCommitCall(base, prepared.repository), base);
  for (const detail of ["none", "stats", "full_patch"] as const) {
    assert.equal(validateHeadCommitCall({ ...base, detail }, prepared.repository).detail, detail);
  }
  assert.throws(
    () => validateHeadCommitCall({ ...base, detail: "files" }, prepared.repository),
    /detail must be one of/,
  );
  assert.throws(
    () => validateHeadCommitCall({ ...base, page: 0 }, prepared.repository),
    /page must be an integer/,
  );
  assert.throws(
    () => validateHeadCommitCall({ ...base, page: 1.5 }, prepared.repository),
    /page must be an integer/,
  );
  assert.throws(
    () => validateHeadCommitCall({ ...base, perPage: 101 }, prepared.repository),
    /perPage must be an integer between 1 and 100/,
  );
  assert.throws(
    () => validateHeadCommitCall({ ...base, perPage: "100" }, prepared.repository),
    /perPage must be an integer between 1 and 100/,
  );
  assert.throws(
    () => validateHeadCommitCall({ ...base, operationId: prepared.operationId }, prepared.repository),
    /unsupported application fields/,
  );
});

test("minimal GitHub create response yields only a receipt, never a reconciled identity", () => {
  const receipt = parseCreatePullRequestResult(
    { success: true, response: { id: 908172, url: "https://github.com/cmdr-chara/evidenceforge/pull/219" } },
    prepared.repository,
  );
  assert.deepEqual(receipt, {
    id: "908172",
    identifier: "#219",
    number: 219,
    url: "https://github.com/cmdr-chara/evidenceforge/pull/219",
  });
  assert.throws(
    () =>
      parsePullRequestReadResult(
        { success: true, response: { id: 908172, url: receipt.url } },
        prepared,
        receipt,
      ),
    /lacks structured head and base/,
  );
});

test("pull_request_read supplies authoritative fields while metadata comes from prepared state", () => {
  const receipt = parseCreatePullRequestResult(
    { id: "node-908172", url: "https://github.com/cmdr-chara/evidenceforge/pull/219" },
    prepared.repository,
  );
  assert.deepEqual(
    validatePullRequestReadCall(
      { owner: "cmdr-chara", repo: "evidenceforge", pullNumber: 219, method: "get" },
      prepared.repository,
      receipt,
    ),
    { owner: "cmdr-chara", repo: "evidenceforge", pullNumber: 219, method: "get" },
  );
  const identity = parsePullRequestReadResult(
    {
      number: 219,
      url: receipt.url,
      head: {
        ref: prepared.head,
        sha: prepared.expectedHeadSha,
        repo: { full_name: prepared.repository },
      },
      base: {
        ref: prepared.base,
        sha: "1111111",
        repo: { full_name: prepared.repository },
      },
      // These values are intentionally ignored by the adapter.
      operationId: "model-forged-operation",
      idempotencyKey: "model-forged-key",
    },
    prepared,
    receipt,
  );
  assert.equal(identity.operationId, prepared.operationId);
  assert.equal(identity.idempotencyKey, prepared.idempotencyKey);
  assert.equal(identity.headSha, prepared.expectedHeadSha);
  assert.throws(
    () =>
      parsePullRequestReadResult(
        {
          head: { ref: prepared.head, sha: "wrongsha", repo: { full_name: prepared.repository } },
          base: { ref: prepared.base, repo: { full_name: prepared.repository } },
        },
        prepared,
        receipt,
      ),
    /head SHA does not match/,
  );
});

test("incident adapter accepts only repository and revision-bound read-only GitHub tools", () => {
  const commit = validateIncidentRead(
    "get_commit",
    { owner: "cmdr-chara", repo: "evidenceforge", sha: "abcdef1234567" },
    { sha: "abcdef1234567", commit: { message: "failure" } },
    prepared.repository,
    prepared.expectedHeadSha,
  );
  assert.equal(commit.repository, prepared.repository);
  assert.throws(
    () =>
      validateIncidentRead(
        "get_run",
        { owner: "cmdr-chara", repo: "evidenceforge", run_id: 842 },
        { id: 842, head_sha: prepared.expectedHeadSha },
        prepared.repository,
        prepared.expectedHeadSha,
      ),
    /not an admissible/,
  );
  assert.throws(
    () =>
      validateIncidentRead(
        "get_commit",
        {
          owner: "cmdr-chara",
          repo: "evidenceforge",
          sha: prepared.expectedHeadSha,
          intent: "evidenceforge.incident-context",
        },
        { sha: prepared.expectedHeadSha },
        prepared.repository,
        prepared.expectedHeadSha,
      ),
    /application-only fields/,
  );
  assert.throws(
    () =>
      validateIncidentRead(
        "get_commit",
        { owner: "cmdr-chara", repo: "other", sha: prepared.expectedHeadSha },
        { sha: prepared.expectedHeadSha },
        prepared.repository,
        prepared.expectedHeadSha,
      ),
    /repository does not match/,
  );
});

test("get_file_contents requires a structured artifact at the exact commit revision", () => {
  const args = {
    owner: "cmdr-chara",
    repo: "evidenceforge",
    sha: prepared.expectedHeadSha,
    path: "README.md",
  };
  const validFile = {
    content: [
      { type: "text", text: "successfully downloaded text file" },
      {
        type: "resource",
        resource: {
          uri: `repo://${prepared.repository}/sha/${prepared.expectedHeadSha}/contents/README.md`,
          mimeType: "text/plain",
          text: "incident details",
        },
      },
    ],
  };
  assert.equal(
    validateIncidentRead("get_file_contents", args, validFile, prepared.repository, prepared.expectedHeadSha).toolName,
    "get_file_contents",
  );
  const verifiedDirectoryEnvelope = {
    repository: prepared.repository,
    revision: prepared.expectedHeadSha,
    artifact: [{ type: "file", name: "README.md", path: "README.md", sha: "a".repeat(40), content: "incident details" }],
  };
  assert.doesNotThrow(() =>
    validateIncidentRead(
      "get_file_contents",
      { ...args, path: "" },
      verifiedDirectoryEnvelope,
      prepared.repository,
      prepared.expectedHeadSha,
    ));
  assert.throws(
    () => validateIncidentRead(
      "get_file_contents",
      args,
      {
        repository: prepared.repository,
        revision: prepared.expectedHeadSha,
        artifact: {
          type: "file",
          path: "other.md",
          sha: "a".repeat(40),
          content: "wrong path",
        },
      },
      prepared.repository,
      prepared.expectedHeadSha,
    ),
    /not bound to incident revision/,
  );
  for (const malformed of [
    {},
    { content: [] },
    { content: [{ type: "text", text: "[]" }] },
    { content: [{ type: "text", text: "successfully downloaded text file" }] },
    { content: [{ type: "text", text: JSON.stringify({ type: "file", path: "README.md" }) }] },
    {
      content: [{
        type: "resource",
        resource: {
          uri: `repo://${prepared.repository}/sha/${prepared.expectedHeadSha}/contents/other.md`,
          mimeType: "text/plain",
          text: "wrong revision binding",
        },
      }],
    },
    {
      type: "file",
      path: "README.md",
      sha: "a".repeat(40),
      content: "stale plain file object",
    },
    {
      content: [{
        type: "text",
        text: JSON.stringify([{ type: "file", path: "README.md", sha: "a".repeat(40), content: "misrouted directory" }]),
      }],
    },
    {
      repository: prepared.repository,
      revision: prepared.expectedHeadSha,
      artifact: [{ type: "file", path: "src/unrelated.ts", sha: "a".repeat(40), content: "wrong child" }],
    },
  ]) {
    assert.throws(
      () => validateIncidentRead("get_file_contents", args, malformed, prepared.repository, prepared.expectedHeadSha),
      /not bound to incident revision/,
    );
  }
  assert.throws(
    () => validateIncidentRead(
      "get_file_contents",
      { ...args, ref: "refs/heads/main", sha: undefined },
      validFile,
      prepared.repository,
      prepared.expectedHeadSha,
    ),
    /not bound to incident revision/,
  );
  for (const path of ["../README.md", "/README.md", "src/../README.md", "src//README.md", "src/./README.md"]) {
    assert.throws(
      () => validateIncidentRead(
        "get_file_contents",
        { ...args, path },
        validFile,
        prepared.repository,
        prepared.expectedHeadSha,
      ),
      /not bound to incident revision/,
      `unsafe requested path ${path} was accepted`,
    );
  }
});

test("incident revision binding never searches titles, bodies, or comments", () => {
  const revision = prepared.expectedHeadSha;
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["issue_read", { owner: "cmdr-chara", repo: "evidenceforge", issue_number: 1, method: "get" }, { title: revision }],
    ["list_issues", { owner: "cmdr-chara", repo: "evidenceforge" }, { issues: [{ body: revision }] }],
    ["search_issues", { query: `repo:${prepared.repository} failure` }, { items: [{ comments: revision }] }],
    ["list_pull_requests", { owner: "cmdr-chara", repo: "evidenceforge" }, { items: [{ title: revision }] }],
    ["search_pull_requests", { query: `repo:${prepared.repository} is:pr` }, { items: [{ body: revision }] }],
    ["pull_request_read", { owner: "cmdr-chara", repo: "evidenceforge", pullNumber: 1, method: "get" }, { body: revision }],
  ];
  for (const [toolName, args, result] of cases) {
    assert.throws(
      () => validateIncidentRead(toolName, args, result, prepared.repository, revision),
      /not bound to incident revision/,
      `${toolName} accepted an unstructured SHA in user-authored content`,
    );
  }

  assert.doesNotThrow(() =>
    validateIncidentRead(
      "pull_request_read",
      { owner: "cmdr-chara", repo: "evidenceforge", pullNumber: 1, method: "get" },
      { head: { ref: prepared.head, sha: revision }, title: "safe title" },
      prepared.repository,
      revision,
    ));
  assert.doesNotThrow(() =>
    validateIncidentRead(
      "list_pull_requests",
      { owner: "cmdr-chara", repo: "evidenceforge" },
      { content: [{ type: "text", text: JSON.stringify([{ head: { sha: revision }, title: "safe title" }]) }] },
      prepared.repository,
      revision,
    ));
});
