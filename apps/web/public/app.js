const state = { snapshot: null, busy: false };

const elements = {
  connection: byId('connection-status'),
  mode: byId('mode-badge'),
  phase: byId('phase-badge'),
  title: byId('incident-title'),
  repository: byId('incident-repository'),
  run: byId('incident-run'),
  revision: byId('incident-revision'),
  trace: byId('trace-id'),
  notice: byId('mode-notice'),
  timeline: byId('phase-timeline'),
  contract: byId('success-contract'),
  contractCount: byId('contract-count'),
  contractProgress: byId('contract-progress-bar'),
  specialists: byId('specialists'),
  hypotheses: byId('hypotheses'),
  evidence: byId('evidence-timeline'),
  evidenceCount: byId('evidence-count'),
  patchPanel: byId('patch-panel'),
  patchDigest: byId('patch-digest'),
  patchDiff: byId('patch-diff'),
  approvalPanel: byId('approval-panel'),
  approvalReason: byId('approval-reason'),
  approvalArguments: byId('approval-arguments'),
  certificatePanel: byId('certificate-panel'),
  certificateContent: byId('certificate-content'),
  advance: byId('advance-button'),
  reset: byId('reset-button'),
  approve: byId('approve-button'),
  reject: byId('reject-button'),
  liveForm: byId('live-form'),
  liveStatus: byId('live-status'),
  activityPanel: byId('activity-panel'),
  activityLog: byId('activity-log'),
  activityCount: byId('activity-count'),
  activitySummary: byId('activity-summary'),
};

elements.advance.addEventListener('click', () => mutate('/api/demo/advance'));
elements.reset.addEventListener('click', () => mutate('/api/demo/reset'));
elements.approve.addEventListener('click', () => decideApproval('APPROVED'));
elements.reject.addEventListener('click', () => decideApproval('DENIED'));
elements.liveForm.addEventListener('submit', startLive);

load();
connectEvents();

async function load() {
  try {
    const taskId = new URL(window.location.href).searchParams.get('task');
    render(await request(taskId === null
      ? '/api/demo/session'
      : `/api/live/session/${encodeURIComponent(taskId)}`));
  } catch (error) {
    showConnection('Disconnected', 'danger');
    elements.notice.textContent = error.message;
  }
}

async function mutate(path) {
  setBusy(true);
  try {
    render(await request(path, { method: 'POST' }));
  } catch (error) {
    elements.notice.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function decideApproval(decision) {
  const snapshot = state.snapshot;
  const approval = snapshot?.approvals.find((item) => item.status === 'PENDING');
  if (!approval || !snapshot) return;
  const path = snapshot.mode === 'LIVE_TRUEFORGE'
    ? `/api/live/session/${encodeURIComponent(snapshot.task.id)}/approvals/${encodeURIComponent(approval.id)}`
    : `/api/demo/approvals/${encodeURIComponent(approval.id)}`;
  setBusy(true);
  try {
    render(
      await request(path, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }),
    );
  } catch (error) {
    elements.notice.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function startLive(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(elements.liveForm));
  elements.liveStatus.textContent = 'Starting durable TrueForge session…';
  elements.liveForm.querySelector('button').disabled = true;
  try {
    const snapshot = await request('/api/live/start', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    render(snapshot);
    elements.liveStatus.textContent = `TrueForge session ${snapshot.trueForgeSessionId ?? 'created'} persisted for task ${snapshot.task.id}.`;
  } catch (error) {
    elements.liveStatus.textContent = `Live mode BLOCKED: ${error.message}`;
  } finally {
    elements.liveForm.querySelector('button').disabled = false;
  }
}

function connectEvents() {
  const source = new EventSource('/api/events');
  source.addEventListener('connected', () => showConnection('Event stream live', 'complete'));
  source.addEventListener('demo-state', (event) => render(JSON.parse(event.data)));
  source.addEventListener('live-state', (event) => render(JSON.parse(event.data)));
  source.addEventListener('runtime-event', (event) => {
    const activity = normalizeActivity(JSON.parse(event.data));
    if (activity === null) return;
    renderActivity([...(state.snapshot?.activity ?? []), activity].slice(-80));
  });
  source.onerror = () => showConnection('Reconnecting', 'warning');
}

function render(input) {
  const snapshot = normalizeSnapshot(input);
  state.snapshot = snapshot;
  syncLocation(snapshot);
  elements.mode.textContent = snapshot.mode.replaceAll('_', ' ');
  elements.mode.className = `status-pill ${snapshot.mode === 'LIVE_TRUEFORGE' ? 'active' : 'warning'}`;
  elements.phase.textContent = snapshot.phase;
  elements.phase.className = `status-pill ${snapshot.status === 'COMPLETED' ? 'complete' : snapshot.status === 'BLOCKED' || snapshot.status === 'ESCALATED' ? 'danger' : 'active'}`;
  elements.title.textContent = snapshot.task.objective;
  elements.repository.textContent = snapshot.task.repository;
  elements.run.textContent = snapshot.task.source.runId;
  elements.revision.textContent = snapshot.task.revision;
  elements.trace.textContent = snapshot.traceId;
  elements.notice.textContent = snapshot.blockedReason ?? snapshot.notice;
  renderTimeline(snapshot.timeline);
  renderContract(snapshot.successCriteria);
  renderSpecialists(snapshot.specialists);
  renderHypotheses(snapshot.hypotheses);
  renderEvidence(snapshot.evidence);
  renderActivity(snapshot.activity ?? []);
  renderPatch(snapshot.patch);
  renderApproval(snapshot.approvals, snapshot.phase);
  renderCertificate(snapshot.completionCertificate);
  elements.advance.textContent = snapshot.phase === 'PUBLISHING' ? 'Reconcile & complete' : 'Advance evidence';
  elements.reset.textContent = snapshot.mode === 'LIVE_TRUEFORGE' ? 'Return to fixture' : 'Reset fixture';
  if (snapshot.mode === 'LIVE_TRUEFORGE') {
    elements.liveStatus.textContent = `Live task ${snapshot.task.id} · ${snapshot.phase} · cursor ${snapshot.lastSequenceNumber ?? '—'}`;
  }
  syncControls();
}

function syncLocation(snapshot) {
  const url = new URL(window.location.href);
  if (snapshot.mode === 'LIVE_TRUEFORGE') url.searchParams.set('task', snapshot.task.id);
  else url.searchParams.delete('task');
  if (url.href !== window.location.href) window.history.replaceState(null, '', url);
}

function normalizeSnapshot(snapshot) {
  if (snapshot?.mode) return snapshot;
  return {
    ...snapshot,
    mode: 'LIVE_TRUEFORGE',
    notice: 'Live TrueForge state. Only application-correlated evidence is displayed.',
    timeline: buildTimeline(snapshot.phase, snapshot.status),
    specialists: [],
    evidence: [],
    approvals: snapshot.approvals ?? [],
    hypotheses: snapshot.hypotheses ?? [],
    successCriteria: snapshot.successCriteria ?? [],
    activity: snapshot.activity ?? [],
  };
}

function buildTimeline(current, statusValue) {
  const order = [
    'INTAKE',
    'DEFINE_SUCCESS',
    'INVESTIGATING',
    'REPRODUCING',
    'PATCHING',
    'VERIFYING',
    'REVIEWING',
    'AWAITING_APPROVAL',
    'PUBLISHING',
    'COMPLETED',
  ];
  const currentIndex = order.indexOf(current === 'PLANNING' ? 'DEFINE_SUCCESS' : current);
  return order.map((phase, index) => ({
    phase,
    status: phase === current
      ? statusValue === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE'
      : index < currentIndex || current === 'COMPLETED'
        ? 'COMPLETE'
        : currentIndex === -1 && statusValue !== 'ACTIVE'
          ? 'BLOCKED'
          : 'PENDING',
  }));
}

function renderTimeline(items) {
  replace(elements.timeline, items.map((item) => {
    const node = el('li', item.phase.replaceAll('_', ' '));
    node.className = item.status.toLowerCase();
    return node;
  }));
}

function renderContract(criteria) {
  const passed = criteria.filter((item) => item.status === 'PASS').length;
  elements.contractCount.textContent = `${passed} / ${criteria.length}`;
  elements.contractProgress.style.width = `${criteria.length === 0 ? 0 : (passed / criteria.length) * 100}%`;
  replace(elements.contract, criteria.map((criterion) => {
    const row = el('div');
    row.className = `contract-item ${criterion.status.toLowerCase()}`;
    const icon = el('span', criterion.status === 'PASS' ? '✓' : criterion.status === 'FAIL' ? '×' : '○');
    icon.className = 'contract-icon';
    const label = el('span', criterion.description);
    label.className = 'contract-description';
    const verifier = el('span', criterion.verifier.kind);
    verifier.className = 'verifier';
    row.append(icon, label, verifier);
    return row;
  }));
}

function renderSpecialists(specialists) {
  if (specialists.length === 0) {
    replace(elements.specialists, [el('p', 'No specialist state has been projected yet.')]);
    return;
  }
  replace(elements.specialists, specialists.map((specialist) => {
    const row = el('div');
    row.className = 'specialist-item';
    row.append(el('span', specialist.name), status(specialist.status));
    return row;
  }));
}

function renderHypotheses(hypotheses) {
  elements.hypotheses.classList.toggle('empty-state', hypotheses.length === 0);
  if (hypotheses.length === 0) {
    elements.hypotheses.textContent = 'No hypotheses recorded yet.';
    return;
  }
  replace(elements.hypotheses, hypotheses.map((hypothesis) => {
    const row = el('div');
    row.className = 'hypothesis-item';
    const id = el('span', hypothesis.id);
    id.className = 'hypothesis-id';
    row.append(id, el('span', hypothesis.statement), status(hypothesis.status));
    return row;
  }));
}

function renderEvidence(evidence) {
  elements.evidenceCount.textContent = `${evidence.length} ${evidence.length === 1 ? 'event' : 'events'}`;
  elements.evidence.classList.toggle('empty-state', evidence.length === 0);
  if (evidence.length === 0) {
    elements.evidence.textContent = 'No admissible evidence yet.';
    return;
  }
  replace(elements.evidence, evidence.map((item) => {
    const row = el('article');
    row.className = 'evidence-item';
    const parsedTime = Date.parse(item.timestamp);
    const time = el('time', Number.isNaN(parsedTime)
      ? '—'
      : new Date(parsedTime).toLocaleTimeString([], { hour12: false }));
    time.className = 'evidence-time';
    if (!Number.isNaN(parsedTime)) time.dateTime = new Date(parsedTime).toISOString();
    const content = el('div');
    const kind = el('span', item.kind);
    kind.className = 'evidence-kind';
    const claim = el('p', item.claim);
    claim.className = 'evidence-claim';
    content.append(kind, claim);
    row.append(time, content);
    return row;
  }));
}

function renderActivity(activity) {
  const isLive = state.snapshot?.mode === 'LIVE_TRUEFORGE';
  elements.activityPanel.classList.toggle('hidden', !isLive);
  if (!isLive) return;

  const log = elements.activityLog;
  const followsLatest = log.scrollHeight - log.scrollTop - log.clientHeight < 56;
  elements.activityCount.textContent = `${activity.length} ${activity.length === 1 ? 'event' : 'events'}`;
  if (activity.length === 0) {
    replace(log, [el('li', 'Waiting for sanitized runtime events…')]);
    log.firstElementChild.className = 'activity-empty';
    elements.activitySummary.textContent = 'Waiting for live activity.';
    return;
  }

  replace(log, activity.map((item) => {
    const row = el('li');
    row.className = `activity-item tone-${item.tone.toLowerCase()}`;
    const parsedTime = Date.parse(item.timestamp);
    const time = el('time', Number.isNaN(parsedTime)
      ? '—'
      : new Date(parsedTime).toLocaleTimeString([], { hour12: false }));
    if (!Number.isNaN(parsedTime)) time.dateTime = new Date(parsedTime).toISOString();
    const label = el('span', item.label);
    label.className = 'activity-label';
    const metaParts = [
      typeof item.phase === 'string' ? item.phase.replaceAll('_', ' ') : null,
      item.sequenceNumber === undefined ? null : `#${item.sequenceNumber}`,
    ].filter(Boolean);
    const meta = el('span', metaParts.join(' · '));
    meta.className = 'activity-meta';
    row.append(time, label, meta);
    return row;
  }));
  const latest = activity.at(-1);
  elements.activitySummary.textContent = latest === undefined ? 'No live activity.' : latest.label;
  state.snapshot.activity = activity;
  if (followsLatest) requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

function normalizeActivity(input) {
  if (!isPlainObject(input)) return null;
  const labels = {
    'trueforge:turn.created': 'TrueForge turn started',
    'trueforge:mcp.initialize': 'MCP connectors initialized',
    'trueforge:sandbox.created': 'Daytona sandbox ready',
    'trueforge:model.message': 'Model checkpoint received',
    'trueforge:thread.created': 'Diagnostic thread started',
    'trueforge:thread.done': 'Diagnostic thread completed',
    'trueforge:tool.response': 'Tool execution completed',
    'trueforge:tool.approval_required': 'Human approval required',
    'trueforge:tool.response_required': 'Human approval required',
    'trueforge:mcp.auth_required': 'Connector authentication required',
    'trueforge:turn.done': 'TrueForge turn completed',
  };
  const turnState = isPlainObject(input.payload) && isPlainObject(input.payload.state)
    ? input.payload.state
    : null;
  const turnTimedOut = input.source === 'trueforge:turn.done'
    && turnState?.status === 'cancelled'
    && turnState?.reason === 'server-execution-timeout';
  const label = typeof input.label === 'string'
    ? input.label
    : turnTimedOut
      ? 'TrueForge turn timed out'
      : labels[input.source];
  if (label === undefined) return null;
  const warningSources = new Set(['trueforge:tool.approval_required', 'trueforge:tool.response_required']);
  const tone = typeof input.tone === 'string'
    ? input.tone
    : input.source === 'trueforge:mcp.auth_required' || turnTimedOut
      ? 'ERROR'
      : warningSources.has(input.source)
        ? 'WARNING'
        : input.source === 'trueforge:turn.created' || input.source === 'trueforge:model.message'
          ? 'INFO'
          : 'SUCCESS';
  return {
    id: typeof input.id === 'string' ? input.id : `activity-${Date.now()}`,
    timestamp: typeof input.timestamp === 'string' ? input.timestamp : new Date().toISOString(),
    sequenceNumber: Number.isFinite(input.sequenceNumber) ? input.sequenceNumber : undefined,
    phase: typeof input.phase === 'string' ? input.phase : state.snapshot?.phase ?? 'INTAKE',
    tone,
    label,
  };
}

function renderPatch(patch) {
  elements.patchPanel.classList.toggle('hidden', !patch);
  if (!patch) return;
  elements.patchDigest.textContent = patch.digest;
  elements.patchDiff.textContent = patch.diff;
}

function renderApproval(approvals, phase) {
  const approval = approvals.find((item) => item.status === 'PENDING');
  elements.approvalPanel.classList.toggle('hidden', !approval || phase !== 'AWAITING_APPROVAL');
  if (!approval) return;
  elements.approvalReason.textContent = approval.reason;
  const args = isPlainObject(approval.normalizedArguments) ? approval.normalizedArguments : {
    value: approval.normalizedArguments,
  };
  replace(elements.approvalArguments, Object.entries(args).slice(0, 6).map(([key, value]) => {
    const group = el('div');
    group.append(el('dt', key), el('dd', formatValue(value)));
    return group;
  }));
}

function renderCertificate(certificate) {
  elements.certificatePanel.classList.toggle('hidden', !certificate);
  if (!certificate) return;
  const fields = [
    ['Task', certificate.taskId],
    ['Criteria', `${certificate.requiredCriteria.length} / ${certificate.requiredCriteria.length} PASS`],
    ['Reviewer', certificate.reviewerVerdict],
    ['Patch digest', certificate.patchDigest.slice(0, 16)],
    ['Trace', certificate.traceId],
    ['External action', certificate.externalAction?.identifier ?? 'none'],
    ['Failure reproduced', String(certificate.originalFailureReproduced)],
    ['Issued', new Date(certificate.generatedAt).toLocaleString()],
  ];
  replace(elements.certificateContent, fields.map(([label, value]) => {
    const group = el('div');
    group.append(el('strong', label), el('span', value));
    return group;
  }));
}

function status(value) {
  const node = el('span', value.replaceAll('_', ' '));
  node.className = `status-pill status-${value.toLowerCase()}`;
  return node;
}

function showConnection(text, variant) {
  elements.connection.textContent = text;
  elements.connection.className = `status-pill ${variant}`;
}

function setBusy(busy) {
  state.busy = busy;
  syncControls();
}

function syncControls() {
  const snapshot = state.snapshot;
  const isFixture = snapshot?.mode === 'DETERMINISTIC_FIXTURE';
  const pendingApproval = snapshot?.approvals.some((item) => item.status === 'PENDING') ?? false;
  elements.advance.disabled = state.busy || !isFixture || snapshot?.status !== 'ACTIVE' || snapshot?.phase === 'AWAITING_APPROVAL';
  elements.advance.classList.toggle('hidden', !isFixture);
  elements.reset.disabled = state.busy;
  elements.approve.disabled = state.busy || !pendingApproval || snapshot?.phase !== 'AWAITING_APPROVAL';
  elements.reject.disabled = state.busy || !pendingApproval || snapshot?.phase !== 'AWAITING_APPROVAL';
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${response.status}`);
  return body;
}

function replace(parent, children) {
  parent.replaceChildren(...children);
}

function el(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}
