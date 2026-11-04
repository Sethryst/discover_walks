let worker = null;
let sequence = 0;
let workerReady = false;
const pending = new Map();

export const compactGraphRoutingEngine = Object.freeze({
  id: 'motherbird-compact-graph',
  label: 'Motherbird compact graph',
  localOnly: true,
  execution: 'device',
  graphFormat: 'motherbird-runtime-graph-v1',
  profiles: ['walking'],
  routeLeg: requestRoute
});

function requestRoute(payload) {
  if (typeof Worker === 'undefined') return Promise.resolve(failure('GRAPH_VERSION_UNAVAILABLE'));
  if (!worker) createWorker();
  const requestId = ++sequence;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const reason = 'Routing worker exceeded 120 seconds and was cancelled.';
      const cancelled = worker;
      worker = null;
      cancelled?.terminate();
      settleAll(failure('ROUTING_TIMEOUT', reason));
    }, 120000);
    pending.set(requestId, { resolve, timer });
    worker.postMessage({ type: 'route', requestId, ...payload });
  });
}

function createWorker() {
  worker = new Worker('./js/offline-router-worker.js?v=20261104-local-engine-1', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') { dispatch('routing-progress', data); return; }
    if (data.type === 'worker-ready') { workerReady = true; dispatch('routing-worker-ready', data); return; }
    if (data.type === 'worker-error') { settleAll(failure('ROUTING_WORKER_ERROR', `${data.message} [phase=${data.phase || 'unknown'}]`)); return; }
    const callback = pending.get(data.requestId);
    if (!callback) return;
    pending.delete(data.requestId);
    clearTimeout(callback.timer);
    callback.resolve(data.result);
  };
  worker.onerror = (event) => {
    const reason = event.message || event.error?.message || event.error?.stack || `${event.filename || 'worker'}:${event.lineno || 0}:${event.colno || 0} [ready=${workerReady}]`;
    settleAll(failure('ROUTING_WORKER_ERROR', reason));
    worker = null;
    workerReady = false;
  };
}

function settleAll(result) {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve(result); }
  pending.clear();
}

function dispatch(type, detail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(type, { detail }));
}

function failure(type, reason = null) {
  return { ok: false, status: type, failure: { type, message: 'Offline routing failed.', reason } };
}

