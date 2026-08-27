(() => {
  const NativeEventSource = window.EventSource;
  const bootstrapSources = [];
  const initialTaskId = normalizeTaskId(
    new URL(window.location.href).searchParams.get('task'),
  );

  function normalizeTaskId(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  function scopedUrl(url) {
    if (initialTaskId === null) return url;
    const target = new URL(url, window.location.href);
    if (target.pathname !== '/api/events') return url;
    target.searchParams.set('task', initialTaskId);
    const page = new URL(window.location.href);
    return target.origin === page.origin
      ? `${target.pathname}${target.search}${target.hash}`
      : target.href;
  }

  function eventMatchesTask(name, event) {
    if (name === 'demo-state') return initialTaskId === null;
    if (name === 'live-state') {
      if (initialTaskId === null) return false;
      try {
        return JSON.parse(event.data)?.task?.id === initialTaskId;
      } catch {
        return false;
      }
    }
    if (name === 'runtime-event') {
      if (initialTaskId === null) return false;
      try {
        const payload = JSON.parse(event.data);
        const eventTaskId = payload?.taskId ?? payload?.task?.id;
        return eventTaskId === undefined || eventTaskId === initialTaskId;
      } catch {
        return false;
      }
    }
    if (name === 'connected' || name === 'stream-error') {
      try {
        const eventTaskId = JSON.parse(event.data)?.taskId;
        return eventTaskId === undefined || eventTaskId === initialTaskId;
      } catch {
        return true;
      }
    }
    return true;
  }

  window.EventSource = class TrackedEventSource extends NativeEventSource {
    constructor(url, options) {
      super(scopedUrl(url), options);
      bootstrapSources.push(this);
    }

    addEventListener(name, listener, options) {
      super.addEventListener(name, (event) => {
        if (eventMatchesTask(name, event)) listener.call(this, event);
      }, options);
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    for (const source of bootstrapSources) source.close();
    window.EventSource = NativeEventSource;

    const app = window.evidenceForge;
    const baseRender = app?.render;
    if (typeof baseRender !== 'function') return;

    let source = null;
    let activeTaskId = null;

    app.render = (input) => {
      const snapshotTaskId = input?.mode === 'LIVE_TRUEFORGE' ? input.task?.id ?? null : null;
      if (
        activeTaskId !== null
        && snapshotTaskId !== null
        && snapshotTaskId !== activeTaskId
      ) {
        return;
      }

      baseRender(input);
      ensureStream(app.getStreamSnapshot?.()?.taskId ?? null);
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
      const streamTaskId = normalized;
      source = new NativeEventSource(path);
      source.addEventListener('connected', () => app.showConnection?.('Event stream live', 'complete'));
      source.addEventListener('demo-state', (event) => {
        if (activeTaskId !== streamTaskId || streamTaskId !== null) return;
        app.render(JSON.parse(event.data));
      });
      source.addEventListener('live-state', (event) => {
        const snapshot = JSON.parse(event.data);
        if (streamTaskId === null || activeTaskId !== streamTaskId || snapshot?.task?.id !== streamTaskId) return;
        app.render(snapshot);
      });
      source.addEventListener('runtime-event', (event) => {
        if (streamTaskId === null || activeTaskId !== streamTaskId) return;
        app.appendRuntimeActivity?.(JSON.parse(event.data), streamTaskId);
      });
      source.addEventListener('stream-error', (event) => {
        const payload = JSON.parse(event.data);
        const notice = document.getElementById('mode-notice');
        if (notice !== null) notice.textContent = payload.error ?? 'Event stream error';
      });
      source.onerror = () => app.showConnection?.('Reconnecting', 'warning');
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
