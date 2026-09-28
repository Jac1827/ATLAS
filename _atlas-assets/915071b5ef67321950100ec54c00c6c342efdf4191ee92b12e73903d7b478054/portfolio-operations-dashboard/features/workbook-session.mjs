export async function openWorkbook(file, signal, sourceBuffer) {
  signal?.throwIfAborted();
  let worker;
  try { worker = new Worker(new URL('./workbook-worker.js?v=a84ceb0fc1dfa1cf', import.meta.url)); }
  catch { return null; } // The caller retains the established parser as a yielding fallback.
  let sequence = 0;
  const pending = new Map();
  let closed = false;
  function close(reason = new DOMException('Workbook preview cancelled', 'AbortError')) {
    if (closed) return;
    closed = true; worker.terminate();
    signal?.removeEventListener('abort', abort);
    for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(reason); }
    pending.clear(); worker.onmessage = worker.onerror = null;
  }
  const abort = () => close(signal.reason);
  signal?.addEventListener('abort', abort, {once:true});
  worker.onmessage = ({data}) => {
    const task = pending.get(data.id); if (!task) return;
    pending.delete(data.id); clearTimeout(task.timer);
    if (data.error) task.reject(new Error(data.error)); else task.resolve(data.result);
  };
  worker.onerror = () => close(new Error('Workbook worker could not load.'));
  function request(operation, data = {}, transfer = []) {
    signal?.throwIfAborted();
    if (closed) return Promise.reject(new Error('Workbook preview is closed.'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => close(new Error('Workbook inspection timed out.')), 120000);
      pending.set(id, {resolve, reject, timer}); worker.postMessage({id, operation, ...data}, transfer);
    });
  }
  try {
    const buffer = sourceBuffer || await file.arrayBuffer(); signal?.throwIfAborted();
    const metadata = await request('open', {buffer}, [buffer]);
    window.AtlasPerformance?.record('workbook-read', metadata.duration, {bytes:file.size});
    return { sheetNames:metadata.sheetNames, sheet: (name, metadata) => request('sheet', {name, metadata}), close };
  } catch (error) {
    close(error);
    if (signal?.aborted) throw error;
    // A parser failure is surfaced to the feature, not retried as a huge main-thread parse.
    throw error;
  }
}
