import { createHash, randomUUID } from "node:crypto";
import {
  ApprovalRequest,
  createSessionState,
  createTask,
  Evidence,
  PullRequestIdentity,
  RuntimeEvent,
  SessionState,
  SuccessCriterion,
  VerificationResult,
  WorkflowPhase,
} from "../../../packages/domain/src";
import { createEvidence, EvidenceStore } from "../../../packages/evidence/src";
import { ExternalActionCoordinator } from "../../../packages/policies/src";
import { DIAGNOSTIC_SPECIALISTS } from "../../../packages/specialists/src";
import {
  artifactBindingFor,
  CompletionGate,
  ProgressEvaluator,
} from "../../../packages/verification/src";
import { buildCiSuccessContract, SessionController } from "../../../packages/workflow/src";

interface TimelineItem {
  phase: WorkflowPhase;
  status: "PENDING" | "ACTIVE" | "COMPLETE" | "BLOCKED";
}

interface SpecialistStatus {
  name: string;
  status: "PENDING" | "RUNNING" | "COMPLETE" | "TIMEOUT";
}

export interface ConsoleSnapshot {
  mode: "DETERMINISTIC_FIXTURE";
  notice: string;
  task: SessionState["task"];
  phase: WorkflowPhase;
  status: SessionState["status"];
  timeline: TimelineItem[];
  successCriteria: SessionState["successCriteria"];
  specialists: SpecialistStatus[];
  hypotheses: SessionState["hypotheses"];
  evidence: Evidence[];
  approvals: ApprovalRequest[];
  patch?: { digest: string; diff: string };
  reviewerVerdict?: SessionState["reviewerVerdict"];
  completionCertificate?: SessionState["completionCertificate"];
  traceId: string;
  blockedReason?: string;
}

const ORDER: WorkflowPhase[] = [
  "INTAKE",
  "DEFINE_SUCCESS",
  "PLANNING",
  "INVESTIGATING",
  "REPRODUCING",
  "PATCHING",
  "VERIFYING",
  "REVIEWING",
  "AWAITING_APPROVAL",
  "PUBLISHING",
  "COMPLETED",
];

export class DemoWorkflow {
  private state: SessionState;
  private readonly evidenceStore = new EvidenceStore();
  private specialists: SpecialistStatus[];
  private diff: string | undefined;
  private sequence = 0;

  public constructor() {
    const task = createTask({
      id: "demo-config-order-regression",
      objective: "Resolve GitHub Actions configuration-order regression",
      repository: "cmdr-chara/evidenceforge-demo-fixture",
      revision: "8f31c0a",
      runId: "842",
      constraints: [
        "Use GitHub MCP for authoritative context",
        "Execute repository code only in Daytona",
        "Require approval before creating the pull request",
      ],
      createdAt: "2026-08-25T19:04:00.000Z",
    });
    this.state = createSessionState(task, buildCiSuccessContract(task));
    this.state.traceId = "trace-demo-842";
    this.specialists = DIAGNOSTIC_SPECIALISTS.map((definition) => ({
      name: definition.name,
      status: "PENDING",
    }));
  }

  public snapshot(): ConsoleSnapshot {
    return {
      mode: "DETERMINISTIC_FIXTURE",
      notice:
        "This console snapshot is driven by deterministic fixture events. Live GitHub MCP and Daytona results appear only when live mode is configured.",
      task: structuredClone(this.state.task),
      phase: this.state.phase,
      status: this.state.status,
      timeline: buildTimeline(this.state.phase, this.state.status),
      successCriteria: structuredClone(this.state.successCriteria),
      specialists: structuredClone(this.specialists),
      hypotheses: structuredClone(this.state.hypotheses),
      evidence: this.evidenceStore.listEvidence(),
      approvals: structuredClone(this.state.approvals),
      patch:
        this.state.patchDigest === undefined || this.diff === undefined
          ? undefined
          : { digest: this.state.patchDigest, diff: this.diff },
      reviewerVerdict: this.state.reviewerVerdict,
      completionCertificate: this.state.completionCertificate,
      traceId: this.state.traceId,
      blockedReason: this.state.blockedReason,
    };
  }

  public advance(): ConsoleSnapshot {
    if (this.state.status !== "ACTIVE") return this.snapshot();
    const controller = new SessionController(this.state);
    switch (this.state.phase) {
      case "INTAKE":
        this.state = controller.transition("DEFINE_SUCCESS", "APPLICATION", "incident accepted");
        break;
      case "DEFINE_SUCCESS":
        this.state = controller.transition("PLANNING", "APPLICATION", "success contract version 1 locked");
        break;
      case "PLANNING":
        this.specialists = this.specialists.map((item) => ({ ...item, status: "RUNNING" }));
        this.state = controller.transition(
          "INVESTIGATING",
          "APPLICATION",
          "three read-only diagnostics launched",
        );
        break;
      case "INVESTIGATING":
        this.completeInvestigation();
        this.state = new SessionController(this.state).transition(
          "REPRODUCING",
          "APPLICATION",
          "evidence aggregated and patching remains serialized",
        );
        break;
      case "REPRODUCING":
        this.pass("incident-context", "Authoritative GitHub run 842 context captured", "VERIFICATION");
        this.pass(
          "failure-reproduced",
          "pnpm test config.test.ts exited 1 with CONFIG_VALIDATION_ORDER",
          "REPRODUCTION",
        );
        this.pass("root-cause-supported", "H3 validation-order regression supported", "VERIFICATION");
        this.state = new SessionController(this.state).transition(
          "PATCHING",
          "APPLICATION",
          "stable failure signature reproduced in Daytona fixture",
        );
        break;
      case "PATCHING":
        this.diff = `diff --git a/src/config.ts b/src/config.ts\n@@\n-validateProductionEnv(env);\n const resolved = applyTestFallback(env);\n+validateProductionEnv(resolved);\n return resolved;`;
        this.state = new SessionController(this.state).setPatchDigest(
          createHash("sha256").update(this.diff).digest("hex"),
        );
        this.state = new SessionController(this.state).transition(
          "VERIFYING",
          "APPLICATION",
          "minimal patch produced",
        );
        break;
      case "VERIFYING":
        this.pass("regression", "regression verifier exited 0", "VERIFICATION");
        this.pass("targeted-tests", "targeted suite exited 0", "VERIFICATION");
        this.pass("typecheck", "typecheck exited 0", "VERIFICATION");
        this.pass("lint", "lint exited 0", "VERIFICATION");
        this.pass("diff-integrity", "git diff --check exited 0", "VERIFICATION");
        this.state = new SessionController(this.state).transition(
          "REVIEWING",
          "APPLICATION",
          "all deterministic verifiers passed",
        );
        break;
      case "REVIEWING":
        this.pass("independent-review", "critical issues: 0; reviewer verdict PASS", "REVIEW");
        this.state = new SessionController(this.state).setReviewerVerdict("PASS");
        this.prepareApproval();
        this.state = new SessionController(this.state).transition(
          "AWAITING_APPROVAL",
          "APPLICATION",
          "external PR write requires approval",
        );
        break;
      case "AWAITING_APPROVAL":
        break;
      case "PUBLISHING":
        this.reconcileFixturePullRequest();
        break;
      case "COMPLETED":
      case "BLOCKED":
      case "ESCALATED":
      case "FAILED":
      case "RETRYING":
      case "REPLANNING":
        break;
    }
    return this.snapshot();
  }

  public decideApproval(id: string, decision: "APPROVED" | "DENIED"): ConsoleSnapshot {
    if (this.state.phase !== "AWAITING_APPROVAL") throw new Error("workflow is not awaiting approval");
    const controller = new SessionController(this.state);
    this.state = controller.decideApproval(id, decision);
    const approval = this.state.approvals.find((item) => item.id === id);
    if (approval === undefined || this.state.externalAction === undefined) {
      throw new Error("approval or external action is missing");
    }
    const coordinator = new ExternalActionCoordinator();
    this.state.externalAction = coordinator.applyApproval(this.state.externalAction, approval);
    if (decision === "DENIED") {
      this.state = new SessionController(this.state).transition(
        "BLOCKED",
        "APPLICATION",
        "human denied pull-request creation",
      );
    } else {
      this.state = new SessionController(this.state).transition(
        "PUBLISHING",
        "APPLICATION",
        "human approved exact pull-request arguments",
      );
    }
    return this.snapshot();
  }

  private completeInvestigation(): void {
    this.specialists = this.specialists.map((item) => ({ ...item, status: "COMPLETE" }));
    const h1Evidence = this.observation("GitHub context shows the required secret is present and masked");
    const h2Evidence = this.observation("Lockfile and CI package-manager versions match");
    const h3Evidence = this.observation("Repository path validates before applying test-mode fallback");
    this.state.hypotheses = [
      {
        id: "H1",
        statement: "missing CI secret",
        status: "REFUTED",
        supportingEvidence: [],
        contradictingEvidence: [h1Evidence.id],
      },
      {
        id: "H2",
        statement: "dependency regression",
        status: "REFUTED",
        supportingEvidence: [],
        contradictingEvidence: [h2Evidence.id],
      },
      {
        id: "H3",
        statement: "validation-order regression",
        status: "SUPPORTED",
        supportingEvidence: [h3Evidence.id],
        contradictingEvidence: [],
      },
    ];
    this.state.evidenceIds.push(h1Evidence.id, h2Evidence.id, h3Evidence.id);
    this.state.version += 1;
  }

  private observation(claim: string): Evidence {
    const event = this.event("TOOL_RESULT", "github-mcp.read");
    const evidence = createEvidence({
      kind: "OBSERVATION",
      sourceEventId: event.id,
      sourceTool: "github-mcp.read",
      claim,
      outcome: "PASS",
      timestamp: event.timestamp,
    });
    this.evidenceStore.recordEvidence(evidence);
    return evidence;
  }

  private pass(
    criterionId: string,
    claim: string,
    kind: "REPRODUCTION" | "VERIFICATION" | "REVIEW",
  ): void {
    const criterion = this.state.successCriteria.find((item) => item.id === criterionId);
    if (criterion === undefined) throw new Error(`unknown demo criterion ${criterionId}`);
    const event = this.event("TOOL_RESULT", `fixture.${criterionId}`);
    const binding = artifactBindingFor(this.state, criterion.evidenceScope);
    const evidence = createEvidence({
      kind,
      sourceEventId: event.id,
      sourceTool: kind === "REVIEW" ? "independent-reviewer" : "daytona.run-command",
      claim,
      outcome: "PASS",
      binding,
      timestamp: event.timestamp,
    });
    this.evidenceStore.recordEvidence(evidence);
    const result: VerificationResult = {
      criterionId,
      status: "PASS",
      verifier: criterion.verifier.kind,
      evidenceIds: [evidence.id],
      details: claim,
      deterministic: kind !== "REVIEW",
      binding,
    };
    this.state = new SessionController(this.state).applyVerification(result);
  }

  private prepareApproval(): void {
    if (this.state.patchDigest === undefined) throw new Error("patch digest missing");
    const coordinator = new ExternalActionCoordinator();
    const prepared = coordinator.preparePullRequest({
      sessionId: this.state.traceId,
      repository: this.state.task.repository,
      base: "main",
      head: "evidenceforge/fix-config-order",
      title: "fix(config): apply test fallback before validation",
      body: "Verified remediation for GitHub Actions run 842.",
      expectedHeadSha: "94cc31d",
      patchDigest: this.state.patchDigest,
      binding: artifactBindingFor(this.state, "EXTERNAL"),
    });
    prepared.approval.id = "approval-demo-pr";
    prepared.approval.toolCallId = "github-create-pr-demo";
    prepared.approval.threadId = "main";
    this.state.externalAction = prepared.action;
    this.state.approvals.push(prepared.approval);
    this.state.version += 1;
  }

  private reconcileFixturePullRequest(): void {
    if (this.state.externalAction === undefined) throw new Error("external action missing");
    const coordinator = new ExternalActionCoordinator(undefined, this.evidenceStore);
    this.state.externalAction = coordinator.markCommitted(this.state.externalAction);
    const event = this.event("EXTERNAL_RECONCILIATION", "github-mcp.reconcile-pull-request");
    const action = this.state.externalAction;
    const identity: PullRequestIdentity = {
      identifier: "#219",
      repository: action.preparedArguments.repository,
      base: action.preparedArguments.base,
      head: action.preparedArguments.head,
      headSha: action.preparedArguments.expectedHeadSha,
      operationId: action.operationId,
      idempotencyKey: action.idempotencyKey,
    };
    this.state.externalAction = coordinator.reconcile(this.state, event, identity);
    const criterion = criterionById(this.state, "external-pr");
    const evidenceId = this.state.externalAction.evidenceId;
    if (evidenceId === undefined) throw new Error("reconciliation evidence missing");
    this.state = new SessionController(this.state).applyVerification({
      criterionId: criterion.id,
      status: "PASS",
      verifier: criterion.verifier.kind,
      evidenceIds: [evidenceId],
      details: "GitHub fixture confirmed exact pull-request identity",
      deterministic: true,
      binding: this.state.externalAction.binding,
    });
    new ProgressEvaluator(this.evidenceStore).evaluate(this.state, "VERIFICATION");
    const decision = new CompletionGate(this.evidenceStore).evaluate(this.state);
    if (!decision.allowed) {
      throw new Error(
        `fixture completion gate blocked: ${decision.failures.map((failure) => failure.message).join("; ")}`,
      );
    }
    this.state = new SessionController(this.state).completeWithCertificate(decision.certificate);
  }

  private event(type: RuntimeEvent["type"], source: string): RuntimeEvent {
    this.sequence += 1;
    const event: RuntimeEvent = {
      id: `demo-event-${this.sequence}-${randomUUID()}`,
      type,
      source,
      timestamp: new Date(
        Date.parse("2026-08-25T19:04:00.000Z") + this.sequence * 15_000,
      ).toISOString(),
      payload: {},
      sequenceNumber: this.sequence,
    };
    this.evidenceStore.recordEvent(event);
    return event;
  }
}

function buildTimeline(current: WorkflowPhase, status: SessionState["status"]): TimelineItem[] {
  const displayOrder: WorkflowPhase[] = ORDER.filter((phase) => phase !== "PLANNING");
  const effectiveCurrent = current === "PLANNING" ? "DEFINE_SUCCESS" : current;
  const currentIndex = displayOrder.indexOf(effectiveCurrent);
  return displayOrder.map((phase, index) => {
    let itemStatus: TimelineItem["status"] = "PENDING";
    if (phase === effectiveCurrent) {
      itemStatus = status === "BLOCKED" || status === "FAILED" || status === "ESCALATED"
        ? "BLOCKED"
        : "ACTIVE";
    } else if (index < currentIndex || current === "COMPLETED") {
      itemStatus = "COMPLETE";
    }
    if (currentIndex === -1 && status !== "ACTIVE") itemStatus = "BLOCKED";
    return { phase, status: itemStatus };
  });
}

export function criterionById(state: SessionState, id: string): SuccessCriterion {
  const criterion = state.successCriteria.find((item) => item.id === id);
  if (criterion === undefined) throw new Error(`unknown criterion: ${id}`);
  return criterion;
}
