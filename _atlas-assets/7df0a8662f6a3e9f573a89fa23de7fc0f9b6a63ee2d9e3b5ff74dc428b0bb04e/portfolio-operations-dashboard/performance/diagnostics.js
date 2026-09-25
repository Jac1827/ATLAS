/* Opt-in local diagnostics. Never retain payloads, document keys or user identities. */
(function (root) {
  'use strict';
  const enabled = ['localhost', '127.0.0.1', '[::1]', 'jac1827.github.io'].includes(root.location.hostname)
    && new URLSearchParams(root.location.search).get('atlasPerf') === '1';
  const limit = 600;
  const events = [];
  const counters = Object.create(null);
  const observers = [];
  const now = () => root.performance.now();
  function record(name, duration = 0, details = {}) {
    if (!enabled) return;
    counters[name] = (counters[name] || 0) + 1;
    // Call sites pass numeric/scalar diagnostics only; no application state is cloned.
    const safe = {};
    for (const key of ['communitiesInspected', 'communitiesChanged', 'staffingRecordsNormalized', 'fullRecordsNormalized', 'staffingRecordsSerialized', 'writesScheduled', 'renderRequests', 'longestSubtask', 'scope', 'reason', 'rows', 'bytes', 'parts', 'failed', 'startTime', 'usedJSHeapSize', 'totalJSHeapSize']) {
      if (['string', 'number', 'boolean'].includes(typeof details[key])) safe[key] = details[key];
    }
    events.push({ name, at: now(), duration, ...safe });
    if (events.length > limit) events.splice(0, events.length - limit);
  }
  function start(name, details) {
    if (!enabled) return () => {};
    const at = now();
    let ended = false;
    return extra => { if (!ended) { ended = true; record(name, now() - at, { ...details, ...extra }); } };
  }
  function memory(reason) {
    const heap = root.performance.memory;
    record('memory', 0, { reason, ...(heap ? { usedJSHeapSize: heap.usedJSHeapSize, totalJSHeapSize: heap.totalJSHeapSize } : {}) });
  }
  function wrap(fn, name, details) {
    return function (...args) {
      const end = start(name, typeof details === 'function' ? details(...args) : details);
      try {
        const value = fn.apply(this, args);
        if (value && typeof value.then === 'function') return value.then(result => {
          end({ rows: Array.isArray(result) ? result.length : undefined }); return result;
        }, error => { end({ failed: true }); throw error; });
        end(); return value;
      } catch (error) { end({ failed: true }); throw error; }
    };
  }
  const api = { enabled, record, start, memory, wrap };
  if (enabled) {
    api.report = () => ({ schemaVersion: 1, browser: root.navigator.userAgent, timeOrigin: root.performance.timeOrigin,
      heapAvailable: !!root.performance.memory, longTaskAvailable: typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask'), counters: { ...counters }, events: events.map(e => ({ ...e })) });
    api.reset = () => { events.length = 0; for (const key of Object.keys(counters)) delete counters[key]; };
    for (const type of ['paint', 'longtask', 'navigation']) {
      try {
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) record(type === 'longtask' ? 'long-task' : type === 'navigation' ? 'navigation-entry' : entry.name, entry.duration, { scope: type, startTime: entry.startTime });
        });
        observer.observe({ type, buffered: true }); observers.push(observer);
      } catch { /* Unsupported metrics remain absent, never reported as zero. */ }
    }
    root.document?.addEventListener('DOMContentLoaded', () => {
      const panel = root.document.createElement('details');
      panel.id = 'atlas-development-performance';
      const summary = root.document.createElement('summary'); summary.textContent = 'Performance measurement report';
      const reset = root.document.createElement('button'); reset.textContent = 'Reset performance measurements'; reset.addEventListener('click', () => api.reset());
      const refresh = root.document.createElement('button'); refresh.textContent = 'Refresh performance report';
      const output = root.document.createElement('pre'); output.id = 'atlas-performance-report'; output.style.cssText = 'max-width:100%;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere';
      const update = () => { memory('report-request'); output.textContent = JSON.stringify(api.report(), null, 2); };
      refresh.addEventListener('click', update); summary.addEventListener('click', update);
      panel.append(summary, reset, refresh, output); root.document.body.appendChild(panel);
    }, {once:true});
    root.document?.addEventListener('click', () => {const at=now();root.requestAnimationFrame(()=>record('click-to-frame',now()-at));}, {capture:true});
    memory('before-startup');
    root.addEventListener('pagehide', () => { observers.forEach(o => o.disconnect()); api.reset(); }, { once: true });
  }
  root.AtlasPerformance = Object.freeze(api);
})(window);
