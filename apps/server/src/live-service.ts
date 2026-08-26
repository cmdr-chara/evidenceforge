import { join, resolve } from "node:path";
import {
  ApprovalRequest,
  digestCanonical,
  createSessionState,
  createTask,
  Evidence,
  RuntimeEvent,
  SessionState,
  WorkflowPhase,
} from "../../../packages/domain/src";
import { EvidenceStore } from "../../../packages/evidence/src";
import {
  JsonRuntimeCheckpointStore,
  RuntimeCheckpoint,
} from "../../../packages/persistence/src";
import { ApprovalPolicy } from "../../../packages/policies/src";
import { DIAGNOSTIC_SPECIALISTS } from "../../../packages/specialists/src";
import { EventJournal } from "../../../packages/telemetry/src";
import {
  buildVerifierManifest,
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

export interface LiveActivityItem {
  id: string;
  timestamp: string;
  sequenceNumber?: number;
  phase: WorkflowPhase;
  tone: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  label: string;
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
  activity: LiveActivityItem[];
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
  private readonly checkpoints = new JsonRuntimeCheckpointStore(
    join(this.root, "checkpoints"),
  );
  private readonly journal = new EventJournal(join(this.root, "events.jsonl"));
  private readonly approvalPolicy = new ApprovalPolicy();
  private readonly activityByTask = new Map<string, LiveActivityItem[]>();

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
    this.activityByTask.set(task.id, [
      {
        id: `activity-${task.id}`,
        timestamp: task.createdAt,
        phase: state.phase,
        tone: "INFO",
        label: "Incident accepted by the control plane",
      },
    ]);
    const evidenceStore = new EvidenceStore();
    const verifierManifest = buildVerifierManifest(state.successCriteria);
    await this.checkpoints.saveCheckpoint(state, evidenceStore);
    const runtime = this.createRuntime(evidenceStore, task.id);
    const message = [
      `Investigate GitHub Actions run ${task.source.runId} for ${task.repository} at ${task.revision}.`,
      "Define the success contract before patching.",
      "Run exactly three read-only diagnostic specialists, reproduce in Daytona, patch serially, verify deterministically, review independently, and pause before creating a pull request.",
      "The following verifier manifest is application-owned and immutable. To run a deterministic verifier, call sandbox.exec using the exact intent, command, and cwd shown, with no environment overrides:",
      JSON.stringify(verifierManifest, null, 2),
      "A command with different arguments is diagnostic only and cannot update the success contract.",
      "Do not claim completion; the application CompletionGate owns that decision.",
    ].join("\n");
    const updated = await runtime.start(state, message);
    const snapshot = this.snapshot(updated, evidenceStore);
    this.broker.publish("live-state", snapshot);
    return snapshot;
  }

  public async resume(taskId: string): Promise<LiveConsoleSnapshot> {
    const checkpoint = await this.requireCheckpoint(taskId);
    const updated = await this.createRuntime(checkpoint.evidenceStore, taskId).resume(
      checkpoint.state,
    );
    const snapshot = this.snapshot(updated, checkpoint.evidenceStore);
    this.broker.publish("live-state", snapshot);
    return snapshot;
  }

  public async decideApproval(
    taskId: string,
    approvalId: string,
    decision: "APPROVED" | "DENIED",
  ): Promise<LiveConsoleSnapshot> {
    const checkpoint = await this.requireCheckpoint(taskId);
    const evidenceStore = checkpoint.evidenceStore;
    const state = checkpoint.state;
    const existing = state.approvals.find((approval) => approval.id === approvalId);
    if (existing === undefined) throw new Error(`unknown approval request: ${approvalId}`);
    if (existing.status !== "PENDING") throw new Error(`approval ${approvalId} is already decided`);
    if (decision === "APPROVED") {
      assertLiveApprovalReady(state, existing, evidenceStore, this.approvalPolicy);
    }

    const controller = new SessionController(state);
    let updated = controller.decideApproval(approvalId, decision);
    if (decision === "DENIED" && updated.status === "ACTIVE") {
      controller.replaceState(updated);
      updated = controller.transition("BLOCKED", "APPLICATION", `approval ${approvalId} was denied`);
    }
    await this.checkpoints.saveCheckpoint(updated, evidenceStore);

    const decided = updated.approvals.find((approval) => approval.id === approvalId);
    if (decided === undefined) throw new Error(`approval ${approvalId} disappeared after persistence`);
    updated = await this.createRuntime(evidenceStore, taskId).submitApproval(
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
      await this.checkpoints.saveCheckpoint(updated, evidenceStore);
    }
    const snapshot = this.snapshot(updated, evidenceStore);
    this.broker.publish("live-state", snapshot);
    return snapshot;
  }

  public async load(taskId: string): Promise<LiveConsoleSnapshot | undefined> {
    const checkpoint = await this.checkpoints.loadCheckpoint(taskId);
    return checkpoint === undefined
      ? undefined
      : this.snapshot(checkpoint.state, checkpoint.evidenceStore);
  }

  private async requireCheckpoint(taskId: string): Promise<RuntimeCheckpoint> {
    const checkpoint = await this.checkpoints.loadCheckpoint(taskId);
    if (checkpoint === undefined) throw new Error(`unknown live task ${taskId}`);
    return checkpoint;
  }

  private createRuntime(evidenceStore: EvidenceStore, taskId: string): DurableTrueForgeRuntime {
    const config = loadTrueForgeConfig();
    return new DurableTrueForgeRuntime(
      new TrueForgeSdkAdapter(config),
      this.checkpoints,
      evidenceStore,
      this.journal,
      (event, state) => {
        const activity = toLiveActivity(event, state.phase);
        if (activity !== undefined) {
          const recent = [...(this.activityByTask.get(taskId) ?? []), activity].slice(-80);
          this.activityByTask.set(taskId, recent);
          this.broker.publish("runtime-event", activity);
        }
        this.broker.publish(
          "live-state",
          this.snapshot(state, evidenceStore),
        );
      },
    );
  }

  private snapshot(state: SessionState, evidenceStore: EvidenceStore): LiveConsoleSnapshot {
    return buildLiveConsoleSnapshot(
      state,
      evidenceStore,
      this.activityByTask.get(state.task.id) ?? [],
    );
  }
}

export function buildLiveConsoleSnapshot(
  state: SessionState,
  evidenceStore: EvidenceStore,
  activity: LiveActivityItem[] = [],
): LiveConsoleSnapshot {
  const evidenceIds = new Set(state.evidenceIds);
  const persistedActivity = evidenceStore
    .listEvents()
    .map((event) => toLiveActivity(event, state.phase))
    .filter((item): item is LiveActivityItem => item !== undefined);
  const activityById = new Map(
    [...persistedActivity, ...activity].map((item) => [item.id, item]),
  );
  const recentActivity = [...activityById.values()]
    .sort((left, right) => {
      if (left.sequenceNumber !== undefined && right.sequenceNumber !== undefined) {
        return left.sequenceNumber - right.sequenceNumber;
      }
      return Date.parse(left.timestamp) - Date.parse(right.timestamp);
    })
    .slice(-80);
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
    activity: structuredClone(recentActivity),
  };
}

export function toLiveActivity(
  event: RuntimeEvent,
  phase: WorkflowPhase,
): LiveActivityItem | undefined {
  const base = {
    id: event.id,
    timestamp: event.timestamp,
    sequenceNumber: event.sequenceNumber,
    phase,
  };
  switch (event.source) {
    case "trueforge:turn.created":
      return { ...base, tone: "INFO", label: "TrueForge turn started" };
    case "trueforge:mcp.initialize":
      return { ...base, tone: "SUCCESS", label: "MCP connectors initialized" };
    case "trueforge:sandbox.created":
      return { ...base, tone: "SUCCESS", label: "Daytona sandbox ready" };
    case "trueforge:model.message":
      return { ...base, tone: "INFO", label: "Model checkpoint received" };
    case "trueforge:thread.created":
      return { ...base, tone: "INFO", label: "Diagnostic thread started" };
    case "trueforge:thread.done":
      return { ...base, tone: "SUCCESS", label: "Diagnostic thread completed" };
    case "trueforge:tool.response":
      return { ...base, tone: "SUCCESS", label: "Tool execution completed" };
    case "trueforge:tool.approval_required":
    case "trueforge:tool.response_required":
      return { ...base, tone: "WARNING", label: "Human approval required" };
    case "trueforge:mcp.auth_required":
      return { ...base, tone: "ERROR", label: "Connector authentication required" };
    case "trueforge:turn.done":
      return turnEndedActivity(event, base);
    default:
      return undefined;
  }
}

function turnEndedActivity(
  event: RuntimeEvent,
  base: Omit<LiveActivityItem, "tone" | "label">,
): LiveActivityItem {
  const payload = asUnknownRecord(event.payload);
  const turnState = asUnknownRecord(payload.state);
  const status = typeof turnState.status === "string" ? turnState.status : undefined;
  const reason = typeof turnState.reason === "string" ? turnState.reason : undefined;
  if (status === "cancelled" || status === "failed") {
    return {
      ...base,
      tone: "ERROR",
      label:
        reason === "server-execution-timeout"
          ? "TrueForge turn timed out"
          : "TrueForge turn failed",
    };
  }
  return { ...base, tone: "SUCCESS", label: "TrueForge turn completed" };
}

function asUnknownRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function assertLiveApprovalReady(
  state: SessionState,
  approval: ApprovalRequest,
  evidenceStore: EvidenceStore,
  policy = new ApprovalPolicy(),
): void {
  if (
    approval.risk === "PRIVILEGED" ||
    approval.risk === "EXTERNAL_DESTRUCTIVE" ||
    approval.risk === "READ_ONLY" ||
    approval.risk === "SANDBOX_MUTATION"
  ) {
    const authorization = policy.authorize({ ...approval, status: "APPROVED" });
    if (!authorization.allowed) throw new Error(authorization.reason);
    return;
  }
  if (!/(^|\.)(create_pull_request)$/i.test(approval.action)) {
    throw new Error(`P0 live publishing supports only pull-request creation, not ${approval.action}`);
  }
  const provenance = approval.provenance;
  if (provenance === undefined) throw new Error("external approval lacks provenance");
  const persistedApproval = state.approvals.find((candidate) => candidate.id === approval.id);
  const operation = state.operations.find(
    (candidate) => candidate.id === provenance.originatingOperationId,
  );
  if (
    provenance.actionDigest !== digestCanonical(approval.normalizedArguments) ||
    persistedApproval === undefined ||
    persistedApproval.provenance?.originatingOperationId !== provenance.originatingOperationId ||
    digestCanonical(persistedApproval.normalizedArguments) !== provenance.actionDigest ||
    provenance.repository !== state.task.repository ||
    provenance.revision !== state.task.revision ||
    provenance.risk !== approval.risk ||
    provenance.consumedAt !== undefined ||
    Date.parse(provenance.expiresAt) <= Date.now() ||
    operation?.actionType !== approval.action ||
    operation.argumentDigest !== provenance.actionDigest ||
    operation.repository !== provenance.repository ||
    operation.revision !== provenance.revision
  ) {
    throw new Error("external approval provenance is stale, substituted, expired, or consumed");
  }
  const authorization = policy.authorize({ ...approval, status: "APPROVED" });
  if (!authorization.allowed) throw new Error(authorization.reason);
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
