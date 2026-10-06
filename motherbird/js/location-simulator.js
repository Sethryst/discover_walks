export const LOCATION_PRESETS = {
  alexandria: { name: 'Alexandria, VA', lat: 38.8048, lng: -77.0469 },
  dc: { name: 'Washington, DC', lat: 38.8951, lng: -77.0364 },
  pgcounty: { name: "Prince George's County, MD", lat: 38.8315, lng: -76.8465 },
  fairfax: { name: 'Fairfax County, VA', lat: 38.8462, lng: -77.3064 }
};
const simulatorEnabled = typeof location !== 'undefined' && (location.hostname === 'localhost' || new URLSearchParams(location.search).has('devtools'));
// Only the preset id is session-persisted. Coordinates are always derived in
// memory from LOCATION_PRESETS so simulated GPS is never serialized or sent.
export const SIMULATOR_SESSION_KEY = 'walk-wildlife:location-simulator:preset';
const STORAGE_KEY = SIMULATOR_SESSION_KEY;
function sessionValue() { try { return simulatorEnabled && globalThis.sessionStorage?.getItem(STORAGE_KEY); } catch { return null; } }
function setSessionValue(value) { try { if (simulatorEnabled && globalThis.sessionStorage) value === null ? globalThis.sessionStorage.removeItem(STORAGE_KEY) : globalThis.sessionStorage.setItem(STORAGE_KEY, value); } catch { /* Private/test contexts may disable storage; memory remains authoritative. */ } }
let simulatedPreset = sessionValue();
let nextWatchId = 0;
const watches = new Map();
export function simulatedPosition(preset) { const point = LOCATION_PRESETS[preset]; if (!point) throw new Error(`Unknown location preset: ${preset}`); return { coords: { latitude: point.lat, longitude: point.lng, accuracy: 10 }, timestamp: Date.now() }; }
export function isLocationSimulatorEnabled() { return simulatorEnabled; }
export function isSimulationActive() { return simulatorEnabled && Boolean(simulatedPreset); }
export function getSimulatedPreset() { return simulatedPreset; }
export function clearSimulation() { simulatedPreset = null; setSessionValue(null); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('location-updated', { detail: null })); }
export function getCurrentPosition(success, error) { if (isSimulationActive()) return success(simulatedPosition(simulatedPreset)); return navigator.geolocation.getCurrentPosition(success, error, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }); }
export function watchPosition(success, error, options) { if (!isSimulationActive()) return navigator.geolocation.watchPosition(success, error, options); const id = ++nextWatchId; watches.set(id, setInterval(() => success(simulatedPosition(simulatedPreset)), 5000)); queueMicrotask(() => success(simulatedPosition(simulatedPreset))); return id; }
export function clearWatch(id) { if (watches.has(id)) { clearInterval(watches.get(id)); watches.delete(id); } else navigator.geolocation.clearWatch(id); }
async function storageReport() {
  const report = [];
  try { const estimate = await navigator.storage?.estimate?.(); if (estimate) report.push(`Quota: ${formatBytes(estimate.quota)} · Used: ${formatBytes(estimate.usage)}`); } catch { report.push('Quota: unavailable'); }
  try { const databases = await indexedDB.databases?.() || []; report.push(`IndexedDB: ${databases.length} database${databases.length === 1 ? '' : 's'}`); } catch { report.push('IndexedDB: unavailable'); }
  try { const cacheNames = await caches.keys(); let entries = 0; for (const name of cacheNames) entries += (await (await caches.open(name)).keys()).length; report.push(`Cache Storage: ${cacheNames.length} cache${cacheNames.length === 1 ? '' : 's'} · ${entries} entries`); } catch { report.push('Cache Storage: unavailable'); }
  try { report.push(`Persistent storage: ${navigator.storage?.persisted ? (await navigator.storage.persisted() ? 'yes' : 'no') : 'unsupported'}`); } catch { report.push('Persistent storage: unavailable'); }
  return report;
}
function formatBytes(value) { if (!Number.isFinite(value)) return '—'; const units = ['B', 'KB', 'MB', 'GB']; let size = value; let unit = 0; while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; } return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`; }
function dispatchPosition() { window.dispatchEvent(new CustomEvent('location-updated', { detail: simulatedPosition(simulatedPreset) })); }
function renderPanel() {
  if (!simulatorEnabled) return;
  const panel = document.createElement('aside'); panel.id = 'locationSimulatorPanel'; panel.className = 'location-simulator-panel';
  panel.innerHTML = `<strong>Location simulator</strong><span class="simulator-warning">SIMULATED LOCATION</span><label>Preset<select id="locationSimulatorPreset">${Object.entries(LOCATION_PRESETS).map(([id, point]) => `<option value="${id}">${point.name}</option>`).join('')}</select></label><div class="simulator-actions"><button type="button" id="useSimulatedLocationButton">Use simulated location</button><button type="button" id="moveSimulatedLocationButton">Move location</button><button type="button" id="clearSimulatedLocationButton">Clear simulation</button></div><output id="locationSimulatorCoordinates">No simulation active</output><small>Accuracy: <span id="locationSimulatorAccuracy">—</span></small><hr><strong>Offline storage</strong><output id="offlineStorageReport">Storage not checked</output><button type="button" id="refreshOfflineStorageButton">Refresh storage usage</button>`;
  document.body.append(panel); const select = panel.querySelector('#locationSimulatorPreset'); select.value = simulatedPreset || 'dc';
  const update = () => { const point = isSimulationActive() ? LOCATION_PRESETS[simulatedPreset] : null; panel.querySelector('#locationSimulatorCoordinates').textContent = point ? `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}` : 'No simulation active'; panel.querySelector('#locationSimulatorAccuracy').textContent = point ? '10 m' : '—'; document.body.classList.toggle('simulated-location-active', Boolean(point)); };
  const activate = () => { simulatedPreset = select.value; setSessionValue(simulatedPreset); dispatchPosition(); update(); };
  panel.querySelector('#useSimulatedLocationButton').onclick = activate; panel.querySelector('#moveSimulatedLocationButton').onclick = activate;
  panel.querySelector('#clearSimulatedLocationButton').onclick = () => { clearSimulation(); update(); };
  panel.querySelector('#refreshOfflineStorageButton').onclick = async () => { const output = panel.querySelector('#offlineStorageReport'); output.textContent = 'Checking…'; output.textContent = (await storageReport()).join(' · '); };
  update();
}
if (simulatorEnabled) window.addEventListener('DOMContentLoaded', renderPanel, { once: true });
