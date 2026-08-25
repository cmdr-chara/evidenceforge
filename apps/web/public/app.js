const state = { snapshot: null };

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
    render(await request('/api/demo/session'));
  } catch (error) {
    showConnection('Disconnected', 'danger');
    elements.notice.textContent = error.message;
  }
}

async function mutate(path) {
  setControlsDisabled(true);
  try {
    render(await request(path, { method: 'POST' }));
  } catch (error) {
    elements.notice.textContent = error.message;
  } finally {
    setControlsDisabled(false);
  }
}

async function decideApproval(decision) {
  const approval = state.snapshot?.approvals.find((item) => item.status === 'PENDING');
  if (!approval) return;
  setControlsDisabled(true);
  try {
    render(
      await request(`/api/demo/approvals/${encodeURIComponent(approval.id)}`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }),
    );
  } catch (error) {
    elements.notice.textContent = error.message;
  } finally {
    setControlsDisabled(false);
  }
}

async function startLive(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(elements.liveForm));
  elements.liveStatus.textContent = 'Starting durable TrueForge session…';
  elements.liveForm.querySelector('button').disabled = true;
  try {
    const session = await request('/api/live/start', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    elements.liveStatus.textContent = `TrueForge session ${session.trueForgeSessionId ?? 'created'} persisted for task ${session.task.id}.`;
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
  source.addEventListener('runtime-event', (event) => {
    const runtimeEvent = JSON.parse(event.data);
    elements.liveStatus.textContent = `TrueForge: ${runtimeEvent.source} · event ${runtimeEvent.id}`;
  });
  source.onerror = () => showConnection('Reconnecting', 'warning');
}

function render(snapshot) {
  state.snapshot = snapshot;
  elements.mode.textContent = snapshot.mode.replaceAll('_', ' ');
  elements.phase.textContent = snapshot.phase;
  elements.phase.className = `status-pill ${snapshot.status === 'COMPLETED' ? 'complete' : snapshot.status === 'BLOCKED' ? 'danger' : 'active'}`;
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
  renderPatch(snapshot.patch);
  renderApproval(snapshot.approvals, snapshot.phase);
  renderCertificate(snapshot.completionCertificate);
  elements.advance.disabled = snapshot.status !== 'ACTIVE' || snapshot.phase === 'AWAITING_APPROVAL';
  elements.advance.textContent = snapshot.phase === 'PUBLISHING' ? 'Reconcile & complete' : 'Advance evidence';
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
    const time = el('time', new Date(item.timestamp).toLocaleTimeString([], { hour12: false }));
    time.className = 'evidence-time';
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
  const args = approval.normalizedArguments ?? {};
  replace(elements.approvalArguments, Object.entries(args).slice(0, 6).map(([key, value]) => {
    const group = el('div');
    group.append(el('dt', key), el('dd', String(value)));
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

function setControlsDisabled(disabled) {
  elements.advance.disabled = disabled;
  elements.reset.disabled = disabled;
  elements.approve.disabled = disabled;
  elements.reject.disabled = disabled;
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

function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}
