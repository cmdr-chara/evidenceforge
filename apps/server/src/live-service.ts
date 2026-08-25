import { join, resolve } from "node:path";
import {
  ApprovalRequest,
  createSessionState,
  createTask,
  Evidence,
  SessionState,
  WorkflowPhase,
} from "../../../packages/domain/src";
import { EvidenceStore } from "../../../packages/evidence/src";
import { JsonSessionStore } from "../../../packages/persistence/src";
import { ApprovalPolicy } from "../../../packages/policies/src";
import { DIAGNOSTIC_SPECIALISTS } from "../../../packages/specialists/src";
import { EventJournal } from "../../../packages/telemetry/src";
import {
  DurableTrueForgeRuntime,
  loadTrueForgeConfig,
  TrueForgeSdkAdapter,
} from "../../../packages/trueforge/src";
import { buildCiSuccessContract, SessionController } from "../../../packages/workflow/src";
import { SseBroker } from "./sse-broker";

export interface StartLiveIncidentInput {
  objective?: string;
  repository: string;
  revision: string;
  runId: string;
  constraints?: string[];
}

interface TimelineItem {
  phase: WorkflowPhase;
  status: "PENDING" | "ACTIVE" | "COMPLETE" | "BLOCKED";
}

interface LiveSpecialistStatus {
  name: string;
  status: "PENDING" | "RUNNING" | "PARTIAL" | "COMPLETE" | "FAILED";
}

export interface LiveConsoleSnapshot {
  mode: "LIVE_TRUEFORGE";
  notice: string;
  task: SessionState["task"];
  phase: WorkflowPhase;
  status: SessionState["status"];
  timeline: TimelineItem[];
  successCriteria: SessionState["successCriteria"];
  specialists: LiveSpecialistStatus[];
  hypotheses: SessionState["hypotheses"];
  evidence: Evidence[];
  approvals: ApprovalRequest[];
  patch?: { digest: string; diff: string };
  reviewerVerdict?: SessionState["reviewerVerdict"];
  completionCertificate?: SessionState["completionCertificate"];
  traceId: string;
  blockedReason?: string;
  trueForgeSessionId?: string;
  activeTurnId?: string;
  lastSequenceNumber?: number;
}

const TIMELINE_ORDER: WorkflowPhase[] = [
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

export class LiveIncidentService {
  private readonly root = resolve(process.cwd(), ".evidenceforge");
  private readonly sessions = new JsonSessionStore(join(this.root, "sessions"));
  private readonly evidence = new EvidenceStore();
  private readonly journal = new EventJournal(join(this.root, "events.jsonl"));
  private readonly approvalPolicy = new ApprovalPolicy();

  public constructor(private readonly broker: SseBroker) {}

  public async start(input: StartLiveIncidentInput): Promise<LiveConsoleSnapshot> {
    const task = createTask({
      objective:
        input.objective?.trim() ||
        `Resolve GitHub Actions run ${input.runId} for ${input.repository}`,
      repository: input.repository,
      revision: input.revision,
      runId: input.runId,
      constraints: input.constraints,
    });
    const state = createSessionState(task, buildCiSuccessContract(task));
    await this.sessions.save(state);
    const runtime = this.createRuntime();
    const message = [
      `Investigate GitHub Actions run ${task.source.runId} for ${task.repository} at ${task.revision}.`,
      "Define the success contract before patching.",
      "Run exactly three read-only diagnostic specialists, reproduce in Daytona, patch serially, verify deterministically, review independently, and pause before creating a pull request.",
      "Do not claim completion; the application CompletionGate owns that decision.",
    ].join("\n");
    const updated = await runtime.start(state, message);
    const snapshot = buildLiveConsoleSnapshot(updated, this.evidence);
    this.broker.publish("live-state", snapshot);
    return snapshot;
  }

  public async resume(taskId: string): Promise<LiveConsoleSnapshot> {
    const state = await this.requireState(taskId);
    const updated = await this.createRuntime().resume(state);
    const snapshot = buildLiveConsoleSnapshot(updated, this.evidence);
    this.broker.publish("live-state", snapshot);
    return snapshot;
  }

  public async decideApproval(
    taskId: string,
    approvalId: string,
    decision: "APPROVED" | "DENIED",
  ): Promise<LiveConsoleSnapshot> {
    const state = await this.requireState(taskId);
    const existing = state.approvals.find((approval) => approval.id === approvalId);
    if (existing === undefined) throw new Error(`unknown approval request: ${approvalId}`);
    if (existing.status !== "PENDING") throw new Error(`approval ${approvalId} is already decided`);
    if (decision === "APPROVED") {
      assertLiveApprovalReady(state, existing, this.evidence, this.approvalPolicy);
    }

    const controller = new SessionController(state);
    let updated = controller.decideApproval(approvalId, decision);
    if (decision === "DENIED" && updated.status === "ACTIVE") {
      controller.replaceState(updated);
      updated = controller.transition("BLOCKED", "APPLICATION", `approval ${approvalId} was denied`);
    }
    await this.sessions.save(updated);

    const decided = updated.approvals.find((approval) => approval.id === approvalId);
    if (decided === undefined) throw new Error(`approval ${approvalId} disappeared after persistence`);
    updated = await this.createRuntime().submitApproval(
      updated,
      decided,
      decision,
      decision === "DENIED" ? "denied by EvidenceForge user" : undefined,
    );

    if (
      decision === "APPROVED" &&
      updated.status === "ACTIVE" &&
      updated.phase === "AWAITING_APPROVAL"
    ) {
      controller.replaceState(updated);
      updated = controller.transition(
        "PUBLISHING",
        "APPLICATION",
        `TrueForge accepted approval ${approvalId}`,
      );
      await this.sessions.save(updated);
    }
    const snapshot = buildLiveConsoleSnapshot(updated, this.evidence);
    this.broker.publish("live-state", snapshot);
    return snapshot;
  }

  public async load(taskId: string): Promise<LiveConsoleSnapshot | undefined> {
    const state = await this.sessions.load(taskId);
    return state === undefined ? undefined : buildLiveConsoleSnapshot(state, this.evidence);
  }

  private async requireState(taskId: string): Promise<SessionState> {
    const state = await this.sessions.load(taskId);
    if (state === undefined) throw new Error(`unknown live task ${taskId}`);
    return state;
  }

  private createRuntime(): DurableTrueForgeRuntime {
    const config = loadTrueForgeConfig();
    return new DurableTrueForgeRuntime(
      new TrueForgeSdkAdapter(config),
      this.sessions,
      this.evidence,
      this.journal,
      (event, state) => {
        this.broker.publish("runtime-event", event);
        this.broker.publish("live-state", buildLiveConsoleSnapshot(state, this.evidence));
      },
    );
  }
}

export function buildLiveConsoleSnapshot(
  state: SessionState,
  evidenceStore: EvidenceStore,
): LiveConsoleSnapshot {
  const evidenceIds = new Set(state.evidenceIds);
  return {
    mode: "LIVE_TRUEFORGE",
    notice:
      "Live TrueForge state. Panels show only application-correlated domain state and admissible evidence; raw model prose never becomes PASS evidence.",
    task: structuredClone(state.task),
    phase: state.phase,
    status: state.status,
    timeline: buildTimeline(state.phase, state.status),
    successCriteria: structuredClone(state.successCriteria),
    specialists: buildSpecialistStatuses(state),
    hypotheses: structuredClone(state.hypotheses),
    evidence: evidenceStore.listEvidence().filter((item) => evidenceIds.has(item.id)),
    approvals: structuredClone(state.approvals),
    patch:
      state.patchDigest === undefined
        ? undefined
        : {
            digest: state.patchDigest,
            diff: "Live diff preview is not persisted in this control-plane snapshot.",
          },
    reviewerVerdict: state.reviewerVerdict,
    completionCertificate: state.completionCertificate,
    traceId: state.traceId,
    blockedReason: state.blockedReason,
    trueForgeSessionId: state.trueForgeSessionId,
    activeTurnId: state.activeTurnId,
    lastSequenceNumber: state.lastSequenceNumber,
  };
}

export function assertLiveApprovalReady(
  state: SessionState,
  approval: ApprovalRequest,
  evidenceStore: EvidenceStore,
  policy = new ApprovalPolicy(),
): void {
  const authorization = policy.authorize({ ...approval, status: "APPROVED" });
  if (!authorization.allowed) throw new Error(authorization.reason);

  if (approval.risk !== "EXTERNAL_REVERSIBLE" && approval.risk !== "UNKNOWN") return;
  if (!/(^|\.)(create_pull_request)$/i.test(approval.action)) {
    throw new Error(`P0 live publishing supports only pull-request creation, not ${approval.action}`);
  }
  if (state.phase !== "AWAITING_APPROVAL") {
    throw new Error(`external approval requires AWAITING_APPROVAL, received ${state.phase}`);
  }

  const failures: string[] = [];
  const criteria = state.successCriteria.filter(
    (criterion) => criterion.required && criterion.verifier.kind !== "EXTERNAL_STATE",
  );
  for (const criterion of criteria) {
    if (criterion.status !== "PASS") {
      failures.push(`${criterion.id}: status ${criterion.status}`);
      continue;
    }
    const result = [...state.verifierResults]
      .reverse()
      .find((candidate) => candidate.criterionId === criterion.id);
    if (result === undefined) {
      failures.push(`${criterion.id}: verifier never ran`);
      continue;
    }
    if (result.status !== "PASS") {
      failures.push(`${criterion.id}: latest verifier result is ${result.status}`);
      continue;
    }
    if (result.verifier !== criterion.verifier.kind) {
      failures.push(
        `${criterion.id}: verifier ${result.verifier} does not match ${criterion.verifier.kind}`,
      );
      continue;
    }
    if (criterion.verifier.kind !== "REVIEWER" && !result.deterministic) {
      failures.push(`${criterion.id}: verifier result is not deterministic`);
      continue;
    }
    const linkedEvidenceIds = result.evidenceIds.filter((id) => criterion.evidenceIds.includes(id));
    if (linkedEvidenceIds.length === 0) {
      failures.push(`${criterion.id}: latest PASS has no criterion-linked evidence`);
      continue;
    }
    if (!linkedEvidenceIds.some((id) => evidenceStore.isAdmissibleForCriterion(id, criterion))) {
      failures.push(`${criterion.id}: latest PASS has no admissible evidence`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`external approval blocked by verification: ${failures.join("; ")}`);
  }
  if (state.reviewerVerdict !== "PASS" && state.reviewerVerdict !== "PASS_WITH_WARNINGS") {
    throw new Error("external approval requires an independent reviewer PASS");
  }
  if (state.patchDigest === undefined) {
    throw new Error("external approval requires a recorded patch digest");
  }
}

function buildTimeline(
  current: WorkflowPhase,
  status: SessionState["status"],
): TimelineItem[] {
  const displayOrder = TIMELINE_ORDER.filter((phase) => phase !== "PLANNING");
  const effectiveCurrent = current === "PLANNING" ? "DEFINE_SUCCESS" : current;
  const currentIndex = displayOrder.indexOf(effectiveCurrent);
  return displayOrder.map((phase, index) => {
    let itemStatus: TimelineItem["status"] = "PENDING";
    if (phase === effectiveCurrent) itemStatus = status === "BLOCKED" ? "BLOCKED" : "ACTIVE";
    else if (index < currentIndex || current === "COMPLETED") itemStatus = "COMPLETE";
    if (currentIndex === -1 && status !== "ACTIVE") itemStatus = "BLOCKED";
    return { phase, status: itemStatus };
  });
}

function buildSpecialistStatuses(state: SessionState): LiveSpecialistStatus[] {
  return DIAGNOSTIC_SPECIALISTS.map((specialist) => {
    const steps = state.plan.steps.filter((step) => step.owner === specialist.name);
    let status: LiveSpecialistStatus["status"] = "PENDING";
    if (steps.some((step) => step.status === "FAILED")) status = "FAILED";
    else if (steps.some((step) => step.status === "RUNNING")) status = "RUNNING";
    else if (steps.length > 0 && steps.every((step) => step.status === "DONE")) status = "COMPLETE";
    else if (steps.some((step) => step.status === "DONE")) status = "PARTIAL";
    return { name: specialist.name, status };
  });
}
