(() => {
  const NativeEventSource = window.EventSource;
  const bootstrapSources = [];

  window.EventSource = class TrackedEventSource extends NativeEventSource {
    constructor(url, options) {
      super(url, options);
      bootstrapSources.push(this);
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    for (const source of bootstrapSources) source.close();
    window.EventSource = NativeEventSource;

    const baseRender = window.render;
    if (typeof baseRender !== 'function') return;

    let source = null;
    let activeTaskId = null;

    window.render = (input) => {
      const snapshotTaskId = input?.mode === 'LIVE_TRUEFORGE' ? input.task?.id ?? null : null;
      if (
        activeTaskId !== null
        && snapshotTaskId !== null
        && snapshotTaskId !== activeTaskId
      ) {
        return;
      }

      baseRender(input);
      const renderedTaskId = input?.mode === 'LIVE_TRUEFORGE' ? input.task?.id ?? null : null;
      ensureStream(renderedTaskId);
      decorateLongValues(input);
    };

    ensureStream(new URL(window.location.href).searchParams.get('task'));

    function ensureStream(taskId) {
      const normalized = typeof taskId === 'string' && taskId.length > 0 ? taskId : null;
      if (source !== null && normalized === activeTaskId) return;
      source?.close();
      activeTaskId = normalized;
      const path = normalized === null
        ? '/api/events'
        : `/api/events?task=${encodeURIComponent(normalized)}`;
      source = new NativeEventSource(path);
      source.addEventListener('connected', () => window.showConnection?.('Event stream live', 'complete'));
      source.addEventListener('demo-state', (event) => {
        if (activeTaskId !== null) return;
        window.render(JSON.parse(event.data));
      });
      source.addEventListener('live-state', (event) => {
        const snapshot = JSON.parse(event.data);
        if (activeTaskId === null || snapshot?.task?.id !== activeTaskId) return;
        window.render(snapshot);
      });
      source.addEventListener('runtime-event', (event) => {
        if (activeTaskId === null) return;
        const snapshot = window.state?.snapshot;
        if (snapshot?.mode !== 'LIVE_TRUEFORGE' || snapshot.task?.id !== activeTaskId) return;
        const activity = window.normalizeActivity?.(JSON.parse(event.data));
        if (activity === null || activity === undefined) return;
        window.renderActivity?.([...(snapshot.activity ?? []), activity].slice(-80));
      });
      source.addEventListener('stream-error', (event) => {
        const payload = JSON.parse(event.data);
        const notice = document.getElementById('mode-notice');
        if (notice !== null) notice.textContent = payload.error ?? 'Event stream error';
      });
      source.onerror = () => window.showConnection?.('Reconnecting', 'warning');
    }

    function decorateLongValues(snapshot) {
      setFullValue('incident-repository', snapshot?.task?.repository);
      setFullValue('incident-revision', snapshot?.task?.revision);
      setFullValue('trace-id', snapshot?.traceId);
      setFullValue('patch-digest', snapshot?.patch?.digest);

      const certificate = snapshot?.completionCertificate;
      if (certificate === undefined) return;
      for (const group of document.querySelectorAll('#certificate-content > div')) {
        const label = group.querySelector('strong')?.textContent;
        const value = group.querySelector('span');
        if (value === null) continue;
        if (label === 'Patch digest') expose(value, certificate.patchDigest);
        if (label === 'Trace') expose(value, certificate.traceId);
        if (label === 'External action') {
          expose(value, certificate.externalAction?.identifier ?? 'none');
        }
      }
    }

    function setFullValue(id, value) {
      if (typeof value !== 'string') return;
      const node = document.getElementById(id);
      if (node !== null) expose(node, value);
    }

    function expose(node, value) {
      node.title = value;
      node.setAttribute('aria-label', value);
    }
  });
})();
