/**
 * Device-only routing engine boundary.
 *
 * Routing adapters receive precise coordinates, so they must explicitly
 * declare that execution is local. This registry intentionally has no HTTP
 * adapter and refuses engines that do not satisfy the local-only contract.
 */
const engines = new Map();
let preferredEngineId = null;

export function registerLocalRoutingEngine(engine, { preferred = false } = {}) {
  if (!engine?.id || typeof engine.routeLeg !== 'function') {
    throw new TypeError('A routing engine requires an id and routeLeg(payload).');
  }
  if (engine.localOnly !== true || engine.execution !== 'device') {
    throw new TypeError(`Routing engine "${engine.id}" must execute only on this device.`);
  }
  engines.set(engine.id, Object.freeze({ ...engine }));
  if (preferred || !preferredEngineId) preferredEngineId = engine.id;
  return () => {
    engines.delete(engine.id);
    if (preferredEngineId === engine.id) preferredEngineId = engines.keys().next().value || null;
  };
}

export function setPreferredLocalRoutingEngine(id) {
  if (!engines.has(id)) throw new Error(`Local routing engine is not registered: ${id}`);
  preferredEngineId = id;
}

export function getLocalRoutingCapabilities() {
  return {
    privacy: 'coordinates-never-leave-device',
    preferredEngineId,
    engines: [...engines.values()].map(({ id, label, profiles = [], graphFormat = null }) => ({
      id, label: label || id, profiles: [...profiles], graphFormat
    }))
  };
}

export async function routeLocalLeg(payload, { engineId = null } = {}) {
  const id = engineId || payload?.cell?.routingEngine || preferredEngineId;
  const engine = engines.get(id);
  if (!engine) return engineFailure('LOCAL_ROUTING_ENGINE_UNAVAILABLE', id || 'none');
  try {
    const result = await engine.routeLeg(payload);
    if (!result || typeof result.ok !== 'boolean') return engineFailure('ROUTING_WORKER_ERROR', `${id} returned an invalid result.`);
    return result.ok ? { ...result, routing_engine: id, routing_execution: 'device' } : result;
  } catch (error) {
    return engineFailure('ROUTING_WORKER_ERROR', error?.message || String(error));
  }
}

function engineFailure(type, reason) {
  return { ok: false, status: type, failure: { type, message: 'Local routing failed.', reason } };
}

