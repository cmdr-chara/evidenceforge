import { createHash } from "node:crypto";
import {
  Evidence,
  Hypothesis,
  PullRequestIdentity,
  RuntimeEvent,
  SessionState,
  VerificationResult,
  WorkflowPhase,
  digestCanonical,
} from "../../../packages/domain/src";
import { createEvidence, EvidenceStore } from "../../../packages/evidence/src";
import { ApprovalPolicy, ExternalActionCoordinator } from "../../../packages/policies/src";
import {
  artifactBindingFor,
  CompletionGate,
  ProgressEvaluator,
  VerificationEngine,
} from "../../../packages/verification/src";
import { DIAGNOSTIC_SPECIALISTS } from "../../../packages/specialists/src";
import { normalizeTrueForgeToolCall } from "../../../packages/trueforge/src";
import { SessionController } from "../../../packages/workflow/src";
import {
  isGitHubReadOnlyTool,
  parseCreatePullRequestArguments,
  parseCreatePullRequestResult,
  parseGetCommitResult,
  parsePullRequestReadResult,
  validateCreatePullRequestCall,
  validateHeadCommitCall,
  validateIncidentRead,
  validatePullRequestReadCall,
} from "./github-mcp-adapter";

/**
 * Structured intents understood by the application-owned live reducer.
 *
 * A model message can request one of these intents, but it cannot satisfy one:
 * the reducer accepts it only after the correlated, structured tool result has
 * been recorded and validated. Free-form prose is deliberately ignored.
 */
export const LIVE_CONTROL_INTENTS = {
  incidentContext: "evidenceforge.incident-context",
  hypothesisLedger: "evidenceforge.hypothesis-ledger",
  patch: "evidenceforge.patch",
  review: "evidenceforge.review",
  externalReconcile: "evidenceforge.external-reconcile",
} as const;

const PATCH_COMMAND = "git diff --binary";
const SANDBOX_CWD = "/workspace/repository";
const INDEPENDENT_REVIEWER = "Independent Patch Reviewer";

const PLAN_STEPS = [
  {
    id: "investigate-repository",
    objective: "Map the failing revision to repository code",
    owner: DIAGNOSTIC_SPECIALISTS[0]?.name ?? "Repository Investigator",
    expectedEvidence: ["incident-context"],
  },
  {
    id: "investigate-failure",
    objective: "Capture the authoritative failure signature and cause",
    owner: DIAGNOSTIC_SPECIALISTS[1]?.name ?? "Failure / Log Investigator",
    expectedEvidence: ["failure-reproduced", "root-cause-supported"],
  },
  {
    id: "investigate-dependencies",
    objective: "Check dependency and configuration assumptions",
    owner: DIAGNOSTIC_SPECIALISTS[2]?.name ?? "Dependency / Configuration Investigator",
    expectedEvidence: ["root-cause-supported"],
  },
  {
    id: "reproduce-failure",
    objective: "Reproduce the original failure in the sandbox",
    owner: "EvidenceForge supervisor",
    expectedEvidence: ["failure-reproduced"],
  },
  {
    id: "patch-serially",
    objective: "Capture the serialized patch subject and digest",
    owner: "EvidenceForge supervisor",
    expectedEvidence: ["patch-digest"],
  },
  {
    id: "verify-deterministically",
    objective: "Run the exact application-owned verifier manifest",
    owner: "EvidenceForge supervisor",
    expectedEvidence: ["deterministic-verifier-results"],
  },
  {
    id: "review-independently",
    objective: "Obtain an independent structured review of the current patch",
    owner: "Independent reviewer",
    expectedEvidence: ["independent-review"],
  },
  {
    id: "publish-and-reconcile",
    objective: "Prepare, approve, commit, and reconcile the external pull request",
    owner: "EvidenceForge supervisor",
    expectedEvidence: ["external-pr"],
  },
] as const;

interface ToolCallDescriptor {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  threadId: string;
  serverName?: string;
  toolType?: string;
}

interface ParsedToolResponse {
  root: Record<string, unknown>;
  result: Record<string, unknown>;
}

/**
 * Projects only application-owned live milestones from correlated runtime
 * events. It is intentionally conservative: an unsupported or incomplete
 * intent leaves the workflow pending, while a malformed claimed control
 * intent blocks it instead of guessing.
 */
export class LiveWorkflowReducer {
  private readonly diagnosticThreads = new Map<string, string>();
  private reviewThreadId: string | undefined;
  private readonly processedEvents = new Set<string>();
  private readonly authoritativeHeadShas = new Map<string, string>();

  public constructor(private readonly evidenceStore: EvidenceStore) {
    for (const event of evidenceStore.listEvents()) this.indexDiagnosticThread(event);
  }

  public apply(state: SessionState, event: RuntimeEvent): void {
    if (state.status !== "ACTIVE" || this.processedEvents.has(event.id)) return;
    this.processedEvents.add(event.id);

    if (event.type === "THREAD_CREATED") {
      this.projectThreadCreated(state, event);
      this.advance(state);
      return;
    }
    if (event.type === "THREAD_DONE") {
      this.projectThreadDone(state, event);
      this.advance(state);
      return;
    }
    if (event.type === "APPROVAL") {
      this.prepareExternalAction(state, event);
      return;
    }
    if (event.type === "EXTERNAL_RECONCILIATION") {
      this.reconcileExternalAction(state, event, readIdentity(event.payload));
      return;
    }
    if (event.type === "TOOL_RESULT") {
      const call = this.findToolCall(event);
      if (call !== undefined) {
        this.projectStructuredIntent(state, event, call);
      }
      this.projectExternalCommit(state, event, call);
      this.projectCorroboratedRootCause(state, event);
      this.advance(state);
    }
  }

  private projectThreadCreated(state: SessionState, event: RuntimeEvent): void {
    const identity = readThreadIdentity(event);
    if (identity?.name === INDEPENDENT_REVIEWER) {
      if (
        state.phase !== "REVIEWING" ||
        this.reviewThreadId !== undefined ||
        !diagnosticsDone(state, this.diagnosticThreads)
      ) {
        block(state, "independent reviewer was created outside the application review phase");
        return;
      }
      this.reviewThreadId = identity.id;
      mutatePlanStep(state, "review-independently", "RUNNING");
      return;
    }
    const thread = readDiagnosticThread(event);
    if (thread === undefined) return;
    if (this.diagnosticThreads.has(thread.id)) return;
    this.diagnosticThreads.set(thread.id, thread.name);

    if (state.phase === "INTAKE") {
      state = transitionInPlace(state, "DEFINE_SUCCESS", "application observed the first diagnostic thread");
    }
    if (state.phase === "DEFINE_SUCCESS") {
      setPlan(state, "RUNNING");
      transitionInPlace(state, "PLANNING", "application-owned diagnostic plan initialized");
    }
  }

  private projectThreadDone(state: SessionState, event: RuntimeEvent): void {
    const threadId = event.threadId ?? readString(asRecord(event.payload), "threadId");
    if (threadId === undefined) return;
    if (threadId === this.reviewThreadId) {
      this.projectIndependentReviewThread(state, event);
      return;
    }
    const owner = this.diagnosticThreads.get(threadId);
    if (owner === undefined) return;
    const status = readString(asRecord(asRecord(event.payload).state), "status");
    if (status !== "done") {
      block(state, "application-owned diagnostic thread did not complete successfully");
      return;
    }
    const step = state.plan.steps.find((candidate) => candidate.owner === owner);
    if (step === undefined || step.status === "DONE") return;
    mutateState(state, (next) => {
      const target = next.plan.steps.find((candidate) => candidate.owner === owner);
      if (target !== undefined) target.status = "DONE";
    });
  }

  private projectCorroboratedRootCause(state: SessionState, event: RuntimeEvent): void {
    const criterion = findCriterion(state, "root-cause-supported");
    if (criterion === undefined || criterion.status === "PASS") return;
    const incident = findCriterion(state, "incident-context");
    const reproduction = findCriterion(state, "failure-reproduced");
    if (incident?.status !== "PASS" || reproduction?.status !== "PASS") return;
    const supportingEvidence = [...incident.evidenceIds, ...reproduction.evidenceIds];
    if (
      supportingEvidence.length < 2 ||
      supportingEvidence.some((id) => this.evidenceStore.getEvidence(id) === undefined)
    ) return;

    const artifactRef = `artifact://${state.task.id}/hypothesis-ledger.json`;
    const claim =
      "Application correlated exact-revision GitHub context with the independently reproduced failure signature";
    const evidence = createEvidence({
      id: `live-${event.id}-root-cause-supported`,
      kind: "VERIFICATION",
      sourceEventId: event.id,
      sourceTool: "evidenceforge.corroborate",
      claim,
      artifactRefs: [artifactRef],
      outcome: "PASS",
      binding: artifactBindingFor(state, "INCIDENT"),
      timestamp: event.timestamp,
      metadata: { supportingEvidenceCount: supportingEvidence.length },
    });
    this.evidenceStore.recordEvidence(evidence);
    Object.assign(state, new SessionController(state).upsertHypothesis({
      id: `hypothesis-${state.task.id}-exact-revision-failure`,
      statement:
        "Behavior at the exact incident revision is consistent with the independently reproduced failure signature.",
      status: "SUPPORTED",
      supportingEvidence,
      contradictingEvidence: [],
    }));
    Object.assign(state, new SessionController(state).applyVerification({
      criterionId: criterion.id,
      status: "PASS",
      verifier: criterion.verifier.kind,
      evidenceIds: [evidence.id],
      details: claim,
      deterministic: true,
      binding: evidence.binding,
    }));
  }

  private projectIndependentReviewThread(state: SessionState, event: RuntimeEvent): void {
    if (state.phase !== "REVIEWING" || state.patchDigest === undefined) {
      block(state, "independent reviewer completed outside the current patch review phase");
      return;
    }
    const payload = asRecord(event.payload);
    const threadState = asRecord(payload.state);
    if (readString(threadState, "status") !== "done") {
      block(state, "independent reviewer did not complete successfully");
      return;
    }
    const content = readString(asRecord(threadState.output), "content");
    const review = content === undefined ? undefined : parseArguments(content);
    const verdict = review === undefined ? undefined : readString(review, "verdict");
    const digest = review === undefined ? undefined : readString(review, "patchDigest");
    const blockers = review === undefined ? undefined : readStringArray(review, "criticalBlockers");
    if (
      digest !== state.patchDigest ||
      (verdict !== "PASS" && verdict !== "PASS_WITH_WARNINGS") ||
      blockers === undefined || blockers.length > 0
    ) {
      block(state, "independent reviewer did not return a valid verdict bound to the current patch");
      return;
    }
    const criterion = findCriterion(state, "independent-review");
    if (criterion === undefined) {
      block(state, "success contract is missing the independent-review criterion");
      return;
    }
    const evaluation = new VerificationEngine(this.evidenceStore).evaluateReviewer(
      criterion,
      event,
      verdict,
      "Isolated TrueForge reviewer passed the current patch subject",
      artifactBindingFor(state, "PATCH"),
    );
    Object.assign(state, new SessionController(state).applyVerification(evaluation.result));
    Object.assign(state, new SessionController(state).setReviewerVerdict(verdict));
    mutatePlanStep(state, "review-independently", "DONE");
  }

  private projectStructuredIntent(
    state: SessionState,
    event: RuntimeEvent,
    call: ToolCallDescriptor,
  ): void {
    if (isGithubCall(call)) {
      // Official GitHub MCP calls have no EvidenceForge intent/artifact
      // fields.  A pull-request read is either incident evidence or the
      // post-create reconciliation step, selected by durable action state.
      if (call.name === "pull_request_read") {
        if (state.externalAction?.status === "COMMITTED") {
          this.projectExternalReconciliation(state, event, call);
        } else {
          this.projectGitHubIncidentContext(state, event, call);
        }
        return;
      }
      if (call.name === "get_commit" && readString(call.arguments, "sha") !== state.task.revision) {
        this.projectHeadCommit(state, event, call);
        return;
      }
      if (isGitHubReadOnlyTool(call.name)) {
        this.projectGitHubIncidentContext(state, event, call);
        return;
      }
      if (call.name === "create_pull_request") {
        // The result is handled by projectExternalCommit after the approval
        // state has been made durable.  Do not interpret its request here.
        return;
      }
      block(state, `GitHub MCP tool ${call.name} is not an admissible live operation`);
      return;
    }
    const intent = readString(call.arguments, "intent");
    if (intent === LIVE_CONTROL_INTENTS.incidentContext) {
      this.projectIncidentContext(state, event, call);
    } else if (intent === LIVE_CONTROL_INTENTS.hypothesisLedger) {
      this.projectHypothesisLedger(state, event, call);
    } else if (intent === LIVE_CONTROL_INTENTS.patch) {
      this.projectPatch(state, event, call);
    } else if (intent === LIVE_CONTROL_INTENTS.review) {
      this.projectReview(state, event, call);
    } else if (intent === LIVE_CONTROL_INTENTS.externalReconcile) {
      this.projectExternalReconciliationIntent(state, event, call);
    }
  }

  private projectHeadCommit(
    state: SessionState,
    event: RuntimeEvent,
    call: ToolCallDescriptor,
  ): void {
    let request: ReturnType<typeof validateHeadCommitCall>;
    try {
      request = validateHeadCommitCall(call.arguments, state.task.repository);
      const response = this.requireSuccessfulResponse(state, event, "pull-request head commit read");
      if (response === undefined) return;
      const commit = parseGetCommitResult(response.result, state.task.repository);
      this.authoritativeHeadShas.set(`${state.task.id}:${request.sha}`, commit.sha);
    } catch (error) {
      block(state, error instanceof Error ? error.message : "pull-request head commit read was invalid");
    }
  }

  private projectGitHubIncidentContext(
    state: SessionState,
    event: RuntimeEvent,
    call: ToolCallDescriptor,
  ): void {
    const criterion = findCriterion(state, "incident-context");
    if (criterion === undefined) {
      block(state, "success contract is missing the incident-context criterion");
      return;
    }
    if (criterion.status === "PASS") return;
    const response = this.requireSuccessfulResponse(state, event, "incident context");
    if (response === undefined) return;
    try {
      validateIncidentRead(
        call.name,
        call.arguments,
        response.result,
        state.task.repository,
        state.task.revision,
      );
    } catch (error) {
      block(state, error instanceof Error ? error.message : "incident context was not bound to GitHub");
      return;
    }
    const expectedRef = `artifact://${state.task.id}/incident-context.json`;
    // artifactRef is application-owned and generated here; it is never
    // supplied to the GitHub MCP call or accepted from connector output.
    this.applySchemaEvidence(
      state,
      event,
      call,
      criterion.id,
      expectedRef,
      `Authoritative GitHub ${call.name} result bound to ${state.task.repository}@${state.task.revision}`,
    );
  }

  private projectIncidentContext(
    state: SessionState,
    event: RuntimeEvent,
    call: ToolCallDescriptor,
  ): void {
    if (!isGithubCall(call)) {
      block(state, "incident context intent must be fulfilled by the GitHub MCP connector");
      return;
    }
    const criterion = findCriterion(state, "incident-context");
    if (criterion === undefined) {
      block(state, "success contract is missing the incident-context criterion");
      return;
    }
    const expectedRef = `artifact://${state.task.id}/incident-context.json`;
    if (readString(call.arguments, "artifactRef") !== expectedRef) {
      block(state, "incident context intent requested the wrong application artifact");
      return;
    }
    const response = this.requireSuccessfulResponse(state, event, "incident context");
    if (response === undefined) return;
    const artifactRefs = readStringArray(response.result, "artifactRefs") ??
      readStringArray(response.root, "artifactRefs") ?? [];
    if (!artifactRefs.includes(expectedRef)) {
      block(state, "incident context result did not produce the required artifact");
      return;
    }
    this.applySchemaEvidence(state, event, call, criterion.id, expectedRef, "authoritative incident context");
  }

  private projectHypothesisLedger(
    state: SessionState,
    event: RuntimeEvent,
    call: ToolCallDescriptor,
  ): void {
    if (!isAuthoritativeReadCall(call)) {
      block(state, "hypothesis ledger intent must be fulfilled by a correlated read-only connector");
      return;
    }
    const criterion = findCriterion(state, "root-cause-supported");
    if (criterion === undefined) {
      block(state, "success contract is missing the root-cause-supported criterion");
      return;
    }
    const expectedRef = `artifact://${state.task.id}/hypothesis-ledger.json`;
    if (readString(call.arguments, "artifactRef") !== expectedRef) {
      block(state, "hypothesis ledger intent requested the wrong application artifact");
      return;
    }
    const response = this.requireSuccessfulResponse(state, event, "hypothesis ledger");
    if (response === undefined) return;
    const artifactRefs = readStringArray(response.result, "artifactRefs") ??
      readStringArray(response.root, "artifactRefs") ?? [];
    if (!artifactRefs.includes(expectedRef)) {
      block(state, "hypothesis ledger result did not produce the required artifact");
      return;
    }
    const hypotheses = parseHypotheses(response.result.hypotheses ?? response.root.hypotheses);
    if (hypotheses === undefined || hypotheses.length === 0) {
      block(state, "hypothesis ledger result has no valid structured hypotheses");
      return;
    }
    const knownEvidence = new Set(state.evidenceIds);
    if (hypotheses.some((hypothesis) =>
      [...hypothesis.supportingEvidence, ...hypothesis.contradictingEvidence].some(
        (id) => !knownEvidence.has(id),
      ))) {
      block(state, "hypothesis ledger references evidence outside the application ledger");
      return;
    }
    if (!hypotheses.some((hypothesis) =>
      (hypothesis.status === "SUPPORTED" || hypothesis.status === "CONFIRMED") &&
      hypothesis.supportingEvidence.length > 0,
    )) {
      block(state, "hypothesis ledger contains no supported root-cause hypothesis");
      return;
    }
    this.applySchemaEvidence(state, event, call, criterion.id, expectedRef, "structured root-cause hypothesis ledger");
    for (const hypothesis of hypotheses) {
      const next = new SessionController(state).upsertHypothesis(hypothesis);
      Object.assign(state, next);
    }
  }

  private projectPatch(
    state: SessionState,
    event: RuntimeEvent,
    call: ToolCallDescriptor,
  ): void {
    if (state.phase !== "PATCHING" || !isSandboxExec(call)) return;
    if (
      readString(call.arguments, "command") !== PATCH_COMMAND ||
      normalizeCwd(readString(call.arguments, "cwd")) !== SANDBOX_CWD ||
      hasEnvironmentOverride(call.arguments)
    ) {
      block(state, "patch intent did not use the exact application-owned sandbox command");
      return;
    }
    const response = this.requireSuccessfulResponse(state, event, "patch capture");
    if (response === undefined) return;
    const exitCode = readNumber(response.result, "exitCode") ?? readNumber(response.root, "exitCode");
    const diff = readString(response.result, "result") ?? readString(response.root, "result");
    if (exitCode !== 0 || diff === undefined || diff.length === 0) {
      block(state, "patch capture did not return a non-empty successful diff");
      return;
    }
    const digest = createHash("sha256").update(diff).digest("hex");
    const next = new SessionController(state).setPatchDigest(digest);
    Object.assign(state, next);
    mutatePlanStep(state, "patch-serially", "DONE");
    transitionInPlace(state, "VERIFYING", "application recorded the exact patch subject digest");
  }

  private projectReview(
    state: SessionState,
    event: RuntimeEvent,
    call: ToolCallDescriptor,
  ): void {
    if (state.phase !== "REVIEWING") return;
    if (!isIndependentReviewCall(call)) {
      block(state, "review intent was not produced by an independent reviewer connector");
      return;
    }
    const response = this.requireSuccessfulResponse(state, event, "independent review");
    if (response === undefined) return;
    const verdict = readString(response.result, "verdict") ??
      readString(response.root, "verdict") ??
      readString(response.result, "reviewVerdict") ??
      readString(response.root, "reviewVerdict");
    if (verdict !== "PASS" && verdict !== "PASS_WITH_WARNINGS") {
      block(state, "independent reviewer did not return an allowed verdict");
      return;
    }
    const criterion = state.successCriteria.find((candidate) => candidate.verifier.kind === "REVIEWER");
    if (criterion === undefined || state.patchDigest === undefined) {
      block(state, "independent review cannot be bound to the current patch");
      return;
    }
    const evaluation = new VerificationEngine(this.evidenceStore).evaluateReviewer(
      criterion,
      event,
      verdict,
      "Structured independent reviewer passed the current patch subject",
      artifactBindingFor(state, "PATCH"),
    );
    const next = new SessionController(state).applyVerification(evaluation.result);
    Object.assign(state, next);
    const reviewed = new SessionController(state).setReviewerVerdict(verdict);
    Object.assign(state, reviewed);
    mutatePlanStep(state, "review-independently", "DONE");
  }

  private projectExternalReconciliationIntent(
    state: SessionState,
    event: RuntimeEvent,
    call: ToolCallDescriptor,
  ): void {
    if (!isGithubCall(call) || call.name !== "pull_request_read") {
      block(state, "external reconciliation requires the official GitHub pull_request_read tool");
      return;
    }
    this.projectExternalReconciliation(state, event, call);
  }

  private projectExternalReconciliation(
    state: SessionState,
    event: RuntimeEvent,
    call: ToolCallDescriptor,
  ): void {
    const action = state.externalAction;
    if (action === undefined || action.status !== "COMMITTED" || action.identifier === undefined) {
      block(state, "external reconciliation requires a committed pull-request receipt");
      return;
    }
    const response = this.requireSuccessfulResponse(state, event, "external reconciliation");
    if (response === undefined) return;
    try {
      const numberMatch = action.identifier.match(/^#(\d+)$/);
      if (numberMatch?.[1] === undefined) {
        throw new Error("committed pull-request receipt has no numeric identifier");
      }
      const receipt = {
        id: action.identifier,
        identifier: action.identifier,
        number: Number(numberMatch[1]),
        url: `https://github.com/${action.preparedArguments.repository}/pull/${numberMatch[1]}`,
      };
      validatePullRequestReadCall(call.arguments, action.preparedArguments.repository, receipt);
      const identity = parsePullRequestReadResult(
        response.result,
        {
          ...action.preparedArguments,
          operationId: action.operationId,
          idempotencyKey: action.idempotencyKey,
        },
        receipt,
      );
      this.reconcileExternalAction(state, event, identity, response.root, response.result);
    } catch (error) {
      block(state, error instanceof Error ? error.message : "external reconciliation result was invalid");
    }
  }

  private projectExternalCommit(
    state: SessionState,
    event: RuntimeEvent,
    call: ToolCallDescriptor | undefined,
  ): void {
    const action = state.externalAction;
    if (action?.status !== "APPROVED" || call === undefined) return;
    const approval = state.approvals.find((candidate) => candidate.toolCallId === call.id);
    if (approval === undefined || approval.action !== "github.create_pull_request" || call.name !== "create_pull_request") return;
    let receipt;
    try {
      validateCreatePullRequestCall(call.arguments, {
        ...action.preparedArguments,
        operationId: action.operationId,
        idempotencyKey: action.idempotencyKey,
      });
      const response = this.parseResponse(event);
      if (response === undefined || !isSuccessfulResponse(response)) {
        throw new Error("external pull-request write did not return a successful structured response");
      }
      receipt = parseCreatePullRequestResult(response.result, action.preparedArguments.repository);
    } catch (error) {
      block(state, error instanceof Error ? error.message : "external pull-request response was invalid");
      return;
    }
    try {
      const committed = new ExternalActionCoordinator().markCommitted(action);
      state.externalAction = { ...committed, identifier: receipt.identifier };
      state.version += 1;
      mutatePlanStep(state, "publish-and-reconcile", "RUNNING");
    } catch (error) {
      block(state, error instanceof Error ? error.message : "external action could not be committed");
    }
  }

  private prepareExternalAction(state: SessionState, event: RuntimeEvent): void {
    if (state.status !== "ACTIVE") return;
    const pending = state.approvals.filter(
      (approval) => approval.risk === "EXTERNAL_REVERSIBLE" && approval.status === "PENDING",
    );
    if (pending.length === 0 || state.externalAction !== undefined) return;
    if (pending.length !== 1 || (state.phase !== "REVIEWING" && state.phase !== "AWAITING_APPROVAL") ||
      (state.reviewerVerdict !== "PASS" && state.reviewerVerdict !== "PASS_WITH_WARNINGS") ||
      !artifactBindingMatchesCurrentReview(state)) {
      block(state, "external pull-request preparation requires an independent review of the current patch");
      return;
    }
    const approval = pending[0];
    if (approval === undefined) return;
    const args = asRecord(approval.normalizedArguments);
    const repository = state.task.repository;
    if (state.patchDigest === undefined) {
      block(state, "external pull-request preparation requires a patch digest");
      return;
    }
    const operationId = approval.provenance?.originatingOperationId;
    if (operationId === undefined || !state.operations.some((operation) => operation.id === operationId)) {
      block(state, "external pull-request approval is not linked to a durable operation intent");
      return;
    }
    try {
      // Parse only the official request first. The head SHA is intentionally
      // absent from that schema and must come from an earlier application-
      // correlated get_commit read for the exact proposed head branch.
      const official = parseCreatePullRequestArguments(args);
      const expectedHeadSha = this.findAuthoritativeHeadSha(state, official.head);
      if (expectedHeadSha === undefined) {
        throw new Error(
          "external pull-request preparation requires an authoritative get_commit result for the proposed head",
        );
      }
      const preparedEnvelope = {
        repository,
        base: official.base,
        head: official.head,
        title: official.title,
        body: official.body,
        expectedHeadSha,
        operationId,
        // Only validation is performed with this envelope value. The real
        // idempotency key is generated by ExternalActionCoordinator below.
        idempotencyKey: "application-prepared",
      };
      validateCreatePullRequestCall(args, preparedEnvelope);
      const base = official.base;
      const head = official.head;
      const title = official.title;
      const body = official.body;
      const prepared = new ExternalActionCoordinator().preparePullRequest({
        sessionId: state.traceId,
        repository,
        base,
        head,
        title,
        body,
        expectedHeadSha,
        patchDigest: state.patchDigest,
        binding: artifactBindingFor(state, "EXTERNAL"),
      });
      const action = { ...prepared.action, operationId };
      const preparedProvenance = prepared.approval.provenance;
      if (preparedProvenance === undefined) {
        throw new Error("prepared pull-request approval lacks provenance");
      }
      const officialDigest = digestCanonical(args);
      const preparedApproval = {
        ...approval,
        provenance: {
          ...preparedProvenance,
          // The runtime submits the official MCP arguments, which do not
          // include expectedHeadSha. Keep provenance aligned to those exact
          // arguments while the expected SHA remains in the prepared action.
          actionDigest: officialDigest,
          // Runtime approval consumption binds the operation to the incident
          // revision. The external action separately binds the proposed PR to
          // its expected head SHA; do not overload provenance.revision with
          // that second subject or runtime submission will reject the action.
          revision: approval.provenance?.revision ?? state.task.revision,
          originatingOperationId: operationId,
        },
      };
      mutateState(state, (next) => {
        next.externalAction = action;
        const target = next.approvals.find((candidate) => candidate.id === approval.id);
        if (target !== undefined) target.provenance = preparedApproval.provenance;
      });
      if (state.phase === "REVIEWING") {
        transitionInPlace(state, "AWAITING_APPROVAL", "application prepared the exact external pull-request action");
      }
    } catch (error) {
      block(state, error instanceof Error ? error.message : "external pull-request preparation failed");
    }
  }

  private findAuthoritativeHeadSha(state: SessionState, head: string): string | undefined {
    const cached = this.authoritativeHeadShas.get(`${state.task.id}:${head}`);
    if (cached !== undefined) return cached;
    for (const event of this.evidenceStore.listEvents().reverse()) {
      if (event.type !== "TOOL_RESULT") continue;
      const call = this.findToolCall(event);
      if (
        call === undefined ||
        !isGithubCall(call) ||
        call.name !== "get_commit" ||
        readString(call.arguments, "sha") !== head
      ) continue;
      const response = this.parseResponse(event);
      if (response === undefined || !isSuccessfulResponse(response)) continue;
      try {
        const request = validateHeadCommitCall(call.arguments, state.task.repository);
        const commit = parseGetCommitResult(response.result, state.task.repository);
        if (request.sha === head) {
          this.authoritativeHeadShas.set(`${state.task.id}:${head}`, commit.sha);
          return commit.sha;
        }
      } catch {
        // A malformed or mismatched read is not usable as a prepared head.
      }
    }
    return undefined;
  }

  private reconcileExternalAction(
    state: SessionState,
    event: RuntimeEvent,
    identity: PullRequestIdentity | undefined,
    ...responseRecords: Record<string, unknown>[]
  ): void {
    const action = state.externalAction;
    if (action === undefined || action.status !== "COMMITTED") {
      block(state, "external reconciliation requires a committed pull-request action");
      return;
    }
    const observed = identity ?? responseRecords.map((record) => readIdentity(record)).find((value): value is PullRequestIdentity => value !== undefined);
    if (observed === undefined) {
      block(state, "external reconciliation did not return a structured pull-request identity");
      return;
    }
    const reconciliationEvent = event.type === "EXTERNAL_RECONCILIATION"
      ? event
      : {
          ...event,
          id: `${event.id}:reconciliation`,
          type: "EXTERNAL_RECONCILIATION" as const,
          source: "evidenceforge:external.reconciliation",
          payload: {
            type: "external.reconciliation",
            sourceEventId: event.id,
            identity: observed,
          },
        };
    if (this.evidenceStore.getEvent(reconciliationEvent.id) === undefined) {
      this.evidenceStore.recordEvent(reconciliationEvent);
    }
    try {
      const coordinator = new ExternalActionCoordinator(new ApprovalPolicy(), this.evidenceStore);
      state.externalAction = coordinator.reconcile(state, reconciliationEvent, observed);
      const criterion = state.successCriteria.find((candidate) => candidate.verifier.kind === "EXTERNAL_STATE");
      if (criterion === undefined || state.externalAction.evidenceId === undefined) {
        throw new Error("success contract is missing the external-pr criterion");
      }
      const result: VerificationResult = {
        criterionId: criterion.id,
        status: "PASS",
        verifier: criterion.verifier.kind,
        evidenceIds: [state.externalAction.evidenceId],
        details: "GitHub confirmed the exact prepared pull-request identity",
        deterministic: true,
        binding: state.externalAction.binding,
      };
      Object.assign(state, new SessionController(state).applyVerification(result));
      mutatePlanStep(state, "publish-and-reconcile", "DONE");
      const round = new ProgressEvaluator(this.evidenceStore).evaluate(state, "VERIFICATION");
      if (round.nextAction !== "COMPLETE_CANDIDATE") {
        block(state, `completion candidate blocked: ${round.missingEvidence.join("; ")}`);
        return;
      }
      const decision = new CompletionGate(this.evidenceStore).evaluate(state);
      if (!decision.allowed) {
        block(state, `completion gate blocked: ${decision.failures.map((failure) => failure.message).join("; ")}`);
        return;
      }
      Object.assign(state, new SessionController(state).completeWithCertificate(decision.certificate));
    } catch (error) {
      block(state, error instanceof Error ? error.message : "external reconciliation failed");
    }
  }

  private applySchemaEvidence(
    state: SessionState,
    event: RuntimeEvent,
    call: ToolCallDescriptor,
    criterionId: string,
    artifactRef: string,
    claim: string,
  ): void {
    const criterion = findCriterion(state, criterionId);
    if (criterion === undefined || criterion.status === "PASS") return;
    const evidence: Evidence = createEvidence({
      id: `live-${event.id}-${criterionId}`,
      kind: "VERIFICATION",
      sourceEventId: event.id,
      sourceTool: sourceTool(call),
      claim,
      artifactRefs: [artifactRef],
      outcome: "PASS",
      binding: artifactBindingFor(state, criterion.evidenceScope),
      timestamp: event.timestamp,
      metadata: { intent: readString(call.arguments, "intent") ?? null },
    });
    this.evidenceStore.recordEvidence(evidence);
    Object.assign(state, new SessionController(state).applyVerification({
      criterionId,
      status: "PASS",
      verifier: criterion.verifier.kind,
      evidenceIds: [evidence.id],
      details: claim,
      deterministic: true,
      binding: evidence.binding,
    }));
  }

  private requireSuccessfulResponse(
    state: SessionState,
    event: RuntimeEvent,
    label: string,
  ): ParsedToolResponse | undefined {
    const response = this.parseResponse(event);
    if (response === undefined || !isSuccessfulResponse(response)) {
      block(state, `${label} intent did not return a successful structured tool result`);
      return undefined;
    }
    return response;
  }

  private parseResponse(event: RuntimeEvent): ParsedToolResponse | undefined {
    const payload = asRecord(event.payload);
    const content = readString(payload, "content");
    if (content === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      return undefined;
    }
    const root = asRecord(parsed);
    const response = asRecord(root.response);
    const output = asRecord(root.output);
    const outputResult = asRecord(output.result);
    const result = Object.keys(response).length > 0
      ? response
      : Object.keys(outputResult).length > 0
        ? outputResult
        : Object.keys(asRecord(root.result)).length > 0
          ? asRecord(root.result)
          : root;
    return { root, result };
  }

  private findToolCall(event: RuntimeEvent): ToolCallDescriptor | undefined {
    const payload = asRecord(event.payload);
    const callId = readString(payload, "toolCallId") ?? readString(payload, "tool_call_id");
    if (callId === undefined) return undefined;
    for (const candidate of this.evidenceStore.listEvents().reverse()) {
      const candidatePayload = asRecord(candidate.payload);
      const rawCalls = candidatePayload.toolCalls ?? candidatePayload.tool_calls;
      if (!Array.isArray(rawCalls)) continue;
      for (const rawCall of rawCalls) {
        const threadId = readString(candidatePayload, "threadId") ??
          readString(candidatePayload, "thread_id") ?? candidate.threadId ?? "main";
        const indexed = normalizeTrueForgeToolCall(rawCall, candidate.id, threadId);
        if (indexed?.id !== callId) continue;
        const args = parseArguments(indexed.arguments);
        if (args === undefined) continue;
        return {
          id: callId,
          name: indexed.name,
          arguments: args,
          threadId: indexed.threadId,
          serverName: indexed.serverName,
          toolType: indexed.toolType,
        };
      }
    }
    return undefined;
  }

  private indexDiagnosticThread(event: RuntimeEvent): void {
    const identity = readThreadIdentity(event);
    if (identity?.name === INDEPENDENT_REVIEWER) {
      this.reviewThreadId = identity.id;
      return;
    }
    const thread = readDiagnosticThread(event);
    if (thread !== undefined) this.diagnosticThreads.set(thread.id, thread.name);
  }

  private advance(state: SessionState): void {
    if (state.status !== "ACTIVE") return;
    if (state.phase === "PLANNING" && diagnosticsDone(state, this.diagnosticThreads)) {
      transitionInPlace(state, "INVESTIGATING", "application observed all three diagnostic threads");
    }
    if (
      state.phase === "INVESTIGATING" &&
      diagnosticsDone(state, this.diagnosticThreads) &&
      criterionPass(state, "incident-context") &&
      criterionPass(state, "root-cause-supported")
    ) {
      transitionInPlace(state, "REPRODUCING", "application accepted incident and hypothesis evidence");
    }
    if (state.phase === "REPRODUCING" && criterionPass(state, "failure-reproduced")) {
      transitionInPlace(state, "PATCHING", "application accepted the independently reproduced failure");
    }
    if (state.phase === "VERIFYING") {
      const failure = state.verifierResults.find(
        (result) => result.deterministic && result.status === "FAIL",
      );
      if (failure !== undefined) {
        block(state, `deterministic verifier ${failure.criterionId} failed`);
        return;
      }
      const allDeterministic = state.successCriteria
        .filter((criterion) => criterion.required && criterion.verifier.kind !== "REVIEWER" && criterion.verifier.kind !== "EXTERNAL_STATE")
        .every((criterion) => criterion.status === "PASS");
      if (allDeterministic) {
        transitionInPlace(state, "REVIEWING", "application accepted all deterministic verifier evidence");
      }
    }
  }
}

/**
 * Mark the action state before handing the already-authorized tool approval to
 * TrueForge. TrueForge owns consumption of the approval provenance, so this
 * deliberately does not set provenance.consumedAt itself.
 */
export function markLiveExternalApproval(
  state: SessionState,
  decision: "APPROVED" | "DENIED",
): void {
  const action = state.externalAction;
  if (action === undefined) throw new Error("external action is not prepared");
  if (action.status !== "PREPARED") {
    throw new Error(`external action cannot be decided from ${action.status}`);
  }
  state.externalAction = {
    ...structuredClone(action),
    status: decision === "APPROVED" ? "APPROVED" : "DENIED",
  };
  state.version += 1;
}

function transitionInPlace(state: SessionState, next: WorkflowPhase, reason: string): SessionState {
  const updated = new SessionController(state).transition(next, "APPLICATION", reason);
  Object.assign(state, updated);
  return state;
}

function mutateState(state: SessionState, mutation: (next: SessionState) => void): void {
  const next = structuredClone(state);
  mutation(next);
  next.version += 1;
  Object.assign(state, new SessionController(next).snapshot());
}

function mutatePlanStep(
  state: SessionState,
  id: string,
  status: "RUNNING" | "DONE",
): void {
  const step = state.plan.steps.find((candidate) => candidate.id === id);
  if (step === undefined || step.status === status) return;
  mutateState(state, (next) => {
    const target = next.plan.steps.find((candidate) => candidate.id === id);
    if (target !== undefined) target.status = status;
  });
}

function setPlan(state: SessionState, status: "RUNNING"): void {
  if (state.plan.steps.length > 0) return;
  mutateState(state, (next) => {
    next.plan = {
      version: 1,
      steps: PLAN_STEPS.map((step) => ({
        ...step,
        dependencies: [],
        expectedEvidence: [...step.expectedEvidence],
        riskCeiling: step.id === "publish-and-reconcile" ? "EXTERNAL_REVERSIBLE" as const : "READ_ONLY" as const,
        status,
        attempts: 1,
      })),
    };
  });
}

function block(state: SessionState, reason: string): void {
  if (state.status !== "ACTIVE") return;
  state.phase = "BLOCKED";
  state.status = "BLOCKED";
  state.blockedReason = reason;
  state.version += 1;
}

function diagnosticsDone(state: SessionState, threads: Map<string, string>): boolean {
  if (threads.size !== DIAGNOSTIC_SPECIALISTS.length) return false;
  return DIAGNOSTIC_SPECIALISTS.every((specialist) =>
    state.plan.steps.some((step) => step.owner === specialist.name && step.status === "DONE"),
  );
}

function criterionPass(state: SessionState, id: string): boolean {
  return state.successCriteria.find((criterion) => criterion.id === id)?.status === "PASS";
}

function findCriterion(state: SessionState, id: string) {
  return state.successCriteria.find((criterion) => criterion.id === id);
}

function artifactBindingMatchesCurrentReview(state: SessionState): boolean {
  const binding = state.reviewBinding;
  return binding !== undefined &&
    binding.scope === "PATCH" &&
    binding.patchDigest === state.patchDigest &&
    binding.taskId === state.task.id &&
    binding.repository === state.task.repository &&
    binding.revision === state.task.revision;
}

function readDiagnosticThread(event: RuntimeEvent): { id: string; name: string } | undefined {
  const identity = readThreadIdentity(event);
  if (identity === undefined) return undefined;
  if (!DIAGNOSTIC_SPECIALISTS.some((specialist) => specialist.name === identity.name)) return undefined;
  return identity;
}

function readThreadIdentity(event: RuntimeEvent): { id: string; name: string } | undefined {
  const payload = asRecord(event.payload);
  const agentInfo = asRecord(payload.agentInfo ?? payload.agent_info);
  const name = readString(agentInfo, "name") ?? readString(payload, "title");
  const id = event.threadId ?? readString(payload, "threadId") ?? readString(payload, "thread_id");
  if (event.type !== "THREAD_CREATED" || id === undefined || name === undefined) return undefined;
  return { id, name };
}

function parseHypotheses(value: unknown): Hypothesis[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: Hypothesis[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const id = readString(record, "id");
    const statement = readString(record, "statement");
    const status = readString(record, "status");
    if (
      id === undefined || statement === undefined ||
      !["OPEN", "SUPPORTED", "REFUTED", "CONFIRMED"].includes(status ?? "")
    ) return undefined;
    const supportingEvidence = readStringArray(record, "supportingEvidence") ??
      readStringArray(record, "supportingEvidenceIds") ?? [];
    const contradictingEvidence = readStringArray(record, "contradictingEvidence") ??
      readStringArray(record, "contradictingEvidenceIds") ?? [];
    parsed.push({
      id,
      statement,
      status: status as Hypothesis["status"],
      supportingEvidence,
      contradictingEvidence,
    });
  }
  return parsed;
}

function readIdentity(value: unknown): PullRequestIdentity | undefined {
  const record = asRecord(value);
  const identifier = readString(record, "identifier") ??
    (typeof record.number === "number" ? `#${String(record.number)}` : undefined);
  const repository = readString(record, "repository");
  const base = readString(record, "base");
  const head = readString(record, "head");
  const headSha = readString(record, "headSha") ?? readString(record, "head_sha");
  const operationId = readString(record, "operationId") ?? readString(record, "operation_id");
  const idempotencyKey = readString(record, "idempotencyKey") ?? readString(record, "idempotency_key");
  if (
    identifier === undefined ||
    repository === undefined ||
    base === undefined ||
    head === undefined ||
    headSha === undefined ||
    operationId === undefined ||
    idempotencyKey === undefined
  ) return undefined;
  return { identifier, repository, base, head, headSha, operationId, idempotencyKey };
}

function isSuccessfulResponse(response: ParsedToolResponse): boolean {
  if (readBoolean(response.root, "success") === false || readBoolean(response.result, "success") === false) return false;
  const status = (readString(response.result, "status") ?? readString(response.root, "status"))?.toUpperCase();
  if (["ERROR", "FAILED", "FAILURE", "DENIED", "TIMEOUT"].includes(status ?? "")) return false;
  const exitCode = readNumber(response.result, "exitCode") ?? readNumber(response.result, "exit_code") ?? readNumber(response.root, "exitCode") ?? readNumber(response.root, "exit_code");
  return exitCode === undefined || exitCode === 0;
}

function isGithubCall(call: ToolCallDescriptor): boolean {
  return call.serverName?.toLowerCase() === "github" && call.threadId.length > 0;
}

function isAuthoritativeReadCall(call: ToolCallDescriptor): boolean {
  const server = call.serverName?.toLowerCase();
  return server !== undefined && server !== "sandbox" && server !== "evidenceforge" && call.name !== "exec";
}

function isSandboxExec(call: ToolCallDescriptor): boolean {
  return call.name === "exec" && (call.serverName === "sandbox" || call.toolType === "truefoundry-system");
}

function isIndependentReviewCall(call: ToolCallDescriptor): boolean {
  const server = call.serverName?.toLowerCase() ?? "";
  const name = call.name.toLowerCase();
  return call.threadId !== "main" &&
    (server.includes("qodo") || server.includes("review")) &&
    ["review", "review_patch", "agentic_review", "review-patch"].includes(name);
}

function sourceTool(call: ToolCallDescriptor): string {
  return call.serverName === undefined ? call.name : `${call.serverName}.${call.name}`;
}

function hasEnvironmentOverride(args: Record<string, unknown>): boolean {
  const env = args.env;
  return env !== undefined && (!isRecord(env) || Object.keys(env).length > 0);
}

function normalizeCwd(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized.length === 0 ? "/" : normalized;
}

function parseArguments(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
