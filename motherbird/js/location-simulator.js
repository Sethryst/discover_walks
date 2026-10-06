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
let simulatedSample = 0;
const watches = new Map();
let networkSimulation = 'normal';
let playbackTimer = null;
let originalFetch = null;
export function simulatedPosition(preset) { const point = LOCATION_PRESETS[preset]; if (!point) throw new Error(`Unknown location preset: ${preset}`); return { coords: { latitude: point.lat, longitude: point.lng, accuracy: 10 }, timestamp: Date.now() }; }
function simulatedWalkPosition(preset) {
  const point = LOCATION_PRESETS[preset];
  if (!point) throw new Error(`Unknown location preset: ${preset}`);
  simulatedSample += 1;
  // Roughly 13 m per sample, bounded to a small local path and below the
  // walk speed guard. Coordinates never leave this browser or session storage.
  const offset = Math.min(simulatedSample, 20) * 0.00014;
  return { coords: { latitude: point.lat + Math.sin(simulatedSample * 0.55) * 0.00006, longitude: point.lng + offset, accuracy: 10 }, timestamp: Date.now() };
}
export function isLocationSimulatorEnabled() { return simulatorEnabled; }
export function isSimulationActive() { return simulatorEnabled && Boolean(simulatedPreset); }
export function getSimulatedPreset() { return simulatedPreset; }
export function clearSimulation() { stopLocationPlayback(); simulatedPreset = null; simulatedSample = 0; setSessionValue(null); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('location-updated', { detail: null })); }
export function getCurrentPosition(success, error) { if (isSimulationActive()) return success(simulatedPosition(simulatedPreset)); return navigator.geolocation.getCurrentPosition(success, error, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }); }
export function watchPosition(success, error, options) { if (!isSimulationActive()) return navigator.geolocation.watchPosition(success, error, options); const id = ++nextWatchId; watches.set(id, setInterval(() => success(simulatedWalkPosition(simulatedPreset)), 5000)); queueMicrotask(() => success(simulatedPosition(simulatedPreset))); return id; }
export function clearWatch(id) { if (watches.has(id)) { clearInterval(watches.get(id)); watches.delete(id); } else navigator.geolocation.clearWatch(id); }
export function stopLocationPlayback() { if (playbackTimer) clearInterval(playbackTimer); playbackTimer = null; }
export function startLocationPlayback(presets = ['alexandria', 'dc', 'fairfax'], intervalMs = 1500) { stopLocationPlayback(); let index = 0; const emit = () => { simulatedPreset = presets[index % presets.length]; setSessionValue(simulatedPreset); dispatchPosition(); index += 1; }; emit(); playbackTimer = setInterval(emit, intervalMs); return stopLocationPlayback; }
function setNetworkSimulation(mode) { networkSimulation = mode; if (!originalFetch) originalFetch = globalThis.fetch; if (mode === 'normal') { if (originalFetch) globalThis.fetch = originalFetch; return; } globalThis.fetch = async (...args) => { if (mode === 'offline') throw new TypeError('Devtools offline simulation'); if (mode === 'slow-3g') await new Promise((resolve) => setTimeout(resolve, 1200)); if (mode === 'flaky' && Math.random() < 0.35) throw new TypeError('Devtools intermittent network simulation'); return originalFetch(...args); }; }
export async function clearOfflineScope(scope) { if (scope === 'tiles' && globalThis.caches) { for (const name of await caches.keys()) if (/tile|osm/i.test(name)) await caches.delete(name); return; } if (scope === 'sync') { const { default: db } = await import('./storage.js'); for (const item of await db.all('spatial_local_operations')) await db.remove('spatial_local_operations', item.id); } }
async function storageReport() {
  const report = [];
  try { const estimate = await navigator.storage?.estimate?.(); if (estimate) report.push(`Quota: ${formatBytes(estimate.quota)} · Used: ${formatBytes(estimate.usage)}`); } catch { report.push('Quota: unavailable'); }
  try { const databases = await indexedDB.databases?.() || []; report.push(`IndexedDB: ${databases.length} database${databases.length === 1 ? '' : 's'}`); } catch { report.push('IndexedDB: unavailable'); }
  try { const cacheNames = await caches.keys(); let entries = 0; for (const name of cacheNames) entries += (await (await caches.open(name)).keys()).length; report.push(`Cache Storage: ${cacheNames.length} cache${cacheNames.length === 1 ? '' : 's'} · ${entries} entries`); } catch { report.push('Cache Storage: unavailable'); }
  try { report.push(`Persistent storage: ${navigator.storage?.persisted ? (await navigator.storage.persisted() ? 'yes' : 'no') : 'unsupported'}`); } catch { report.push('Persistent storage: unavailable'); }
  return report;
}
export async function offlineDiagnosticsReport() {
  const report = { generatedAt: new Date().toISOString(), storage: await storageReport(), databases: [], caches: [], serviceWorker: null, opfs: { supported: false, files: 0, bytes: 0 }, sync: { queued: 0, failed: 0 }, freshness: [], readiness: { score: 0, checks: [] }, performance: { navigationMs: Math.round(performance.getEntriesByType?.('navigation')?.[0]?.duration || performance.now()), resourceCount: performance.getEntriesByType?.('resource')?.length || 0 }, networkSimulation, privacy: { preciseLocationIncluded: false, networkTransmitted: false, diagnosticsLocalOnly: true } };
  try { for (const database of await indexedDB.databases?.() || []) { const detail = { name: database.name, version: database.version, stores: [] }; await new Promise((resolve) => { const request = indexedDB.open(database.name); request.onsuccess = () => { const db = request.result; const names = [...db.objectStoreNames]; if (!names.length) { db.close(); resolve(); return; } let remaining = names.length; for (const name of names) { const count = db.transaction(name, 'readonly').objectStore(name).count(); count.onsuccess = () => { detail.stores.push({ name, records: count.result }); if (!--remaining) { db.close(); resolve(); } }; count.onerror = () => { detail.stores.push({ name, records: null }); if (!--remaining) { db.close(); resolve(); } }; } }; request.onerror = resolve; }); report.databases.push(detail); } } catch { /* diagnostics remain partial */ }
  try { for (const name of await caches.keys()) { const keys = await (await caches.open(name)).keys(); report.caches.push({ name, entries: keys.length, sample: keys.slice(0, 5).map((key) => key.url) }); } } catch { /* diagnostics remain partial */ }
  report.cacheHealth = { shellVersions: report.caches.filter((cache) => cache.name.startsWith('walk-wildlife-shell-')).map((cache) => cache.name), staleShellVersions: report.caches.filter((cache) => cache.name.startsWith('walk-wildlife-shell-')).length > 1 };
  try { const registration = await navigator.serviceWorker?.getRegistration(); report.serviceWorker = { supported: Boolean(navigator.serviceWorker), scope: registration?.scope || null, active: registration?.active?.scriptURL || null, waiting: Boolean(registration?.waiting), installing: Boolean(registration?.installing) }; } catch { report.serviceWorker = { supported: false }; }
  try { const root = await navigator.storage?.getDirectory?.(); if (root) { report.opfs.supported = true; const walk = async (directory) => { for await (const entry of directory.values()) { if (entry.kind === 'file') { report.opfs.files += 1; report.opfs.bytes += (await entry.getFile()).size; } else await walk(entry); } }; await walk(root); } } catch { /* OPFS is optional */ }
  try { const { default: db } = await import('./storage.js'); const queue = await db.all('spatial_local_operations'); report.sync.queued = queue.filter((item) => item.deliveryState === 'queued').length; report.sync.failed = queue.filter((item) => item.deliveryState === 'failed').length; const regions = await db.all('regions'); report.freshness = regions.slice(0, 20).map((region) => ({ id: region.id, installedAt: region.installedAt || null, status: region.status || 'unknown' })); } catch { /* local DB may be unavailable */ }
  const checks = [
    ['service worker active', Boolean(report.serviceWorker?.active)],
    ['cache storage available', report.caches.length > 0],
    ['indexeddb available', report.databases.length > 0],
    ['persistent storage', report.storage.some((line) => line.includes('Persistent storage: yes'))],
    ['offline network mode exercised', networkSimulation !== 'normal']
  ]; report.readiness.checks = checks.map(([name, pass]) => ({ name, pass })); report.readiness.score = Math.round(checks.filter(([, pass]) => pass).length / checks.length * 100);
  return report;
}
function diagnosticsText(report) { return JSON.stringify({ ...report, privacy: { preciseLocationIncluded: false, networkTransmitted: false } }, null, 2); }
function downloadDiagnostics(report) { const blob = new Blob([diagnosticsText(report)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `walk-wildlife-offline-diagnostics-${Date.now()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); }
function formatBytes(value) { if (!Number.isFinite(value)) return '—'; const units = ['B', 'KB', 'MB', 'GB']; let size = value; let unit = 0; while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; } return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`; }
function dispatchPosition() { window.dispatchEvent(new CustomEvent('location-updated', { detail: simulatedPosition(simulatedPreset) })); }
function renderPanel() {
  if (!simulatorEnabled) return;
  const panel = document.createElement('aside'); panel.id = 'locationSimulatorPanel'; panel.className = 'location-simulator-panel';
  panel.innerHTML = `<details id="locationSimulatorDetails"><summary><strong>Location simulator</strong><span class="simulator-warning">DEVTOOLS · LOCAL ONLY</span></summary><label>Preset<select id="locationSimulatorPreset">${Object.entries(LOCATION_PRESETS).map(([id, point]) => `<option value="${id}">${point.name}</option>`).join('')}</select></label><div class="simulator-actions"><button type="button" id="useSimulatedLocationButton">Use simulated location</button><button type="button" id="moveSimulatedLocationButton">Move location</button><button type="button" id="playLocationSimulationButton">Play location route</button><button type="button" id="startSimulatedWalkButton">Start simulated walk</button><button type="button" id="clearSimulatedLocationButton">Clear simulation</button></div><output id="locationSimulatorCoordinates">No simulation active</output><small>Accuracy: <span id="locationSimulatorAccuracy">—</span></small><hr><strong>Offline diagnostics</strong><label>Network test<select id="networkSimulationSelect"><option value="normal">Normal network</option><option value="offline">Offline</option><option value="slow-3g">Slow 3G</option><option value="flaky">Intermittent</option></select></label><output id="offlineStorageReport">Storage not checked</output><div class="simulator-actions"><button type="button" id="refreshOfflineStorageButton">Refresh diagnostics</button><button type="button" id="exportOfflineDiagnosticsButton">Export privacy-safe report</button><button type="button" id="clearTileCacheButton">Clear tile cache</button><button type="button" id="clearSyncQueueButton">Clear sync queue</button></div></details>`;
  document.body.append(panel); const select = panel.querySelector('#locationSimulatorPreset'); select.value = simulatedPreset || 'dc';
  const update = () => { const point = isSimulationActive() ? LOCATION_PRESETS[simulatedPreset] : null; panel.querySelector('#locationSimulatorCoordinates').textContent = point ? `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}` : 'No simulation active'; panel.querySelector('#locationSimulatorAccuracy').textContent = point ? '10 m' : '—'; document.body.classList.toggle('simulated-location-active', Boolean(point)); };
  window.addEventListener('location-updated', update);
  const activate = () => { simulatedPreset = select.value; setSessionValue(simulatedPreset); dispatchPosition(); update(); };
  panel.querySelector('#useSimulatedLocationButton').onclick = activate; panel.querySelector('#moveSimulatedLocationButton').onclick = activate;
  panel.querySelector('#playLocationSimulationButton').onclick = () => startLocationPlayback();
  panel.querySelector('#startSimulatedWalkButton').onclick = async () => {
    // Developer walk capture must never fall through to hardware geolocation:
    // activate the local preset first, then let walk.js consume that position.
    simulatedPreset = select.value;
    setSessionValue(simulatedPreset);
    dispatchPosition();
    update();
    const { startWalk } = await import('./walk.js');
    await startWalk({ routeMode: 'tracking' });
  };
  panel.querySelector('#networkSimulationSelect').onchange = (event) => { setNetworkSimulation(event.target.value); panel.dataset.networkSimulation = event.target.value; };
  panel.querySelector('#clearSimulatedLocationButton').onclick = () => { clearSimulation(); update(); };
  panel.querySelector('#clearTileCacheButton').onclick = async () => { await clearOfflineScope('tiles'); panel.querySelector('#offlineStorageReport').textContent = 'Tile cache cleared locally.'; };
  panel.querySelector('#clearSyncQueueButton').onclick = async () => { await clearOfflineScope('sync'); panel.querySelector('#offlineStorageReport').textContent = 'Sync queue cleared locally.'; };
  panel.querySelector('#refreshOfflineStorageButton').onclick = async () => { const output = panel.querySelector('#offlineStorageReport'); output.textContent = 'Checking…'; const report = await offlineDiagnosticsReport(); output.textContent = `Readiness: ${report.readiness.score}% · ${report.storage.join(' · ')} · OPFS: ${report.opfs.supported ? `${report.opfs.files} files / ${formatBytes(report.opfs.bytes)}` : 'unsupported'} · SW: ${report.serviceWorker?.active ? 'active' : 'not active'} · Shell cache: ${report.cacheHealth.staleShellVersions ? 'STALE VERSION(S)' : 'current'}`; panel.dataset.lastDiagnostics = JSON.stringify(report); };
  panel.querySelector('#exportOfflineDiagnosticsButton').onclick = async () => downloadDiagnostics(await offlineDiagnosticsReport());
  update();
}
if (simulatorEnabled) {
  window.addEventListener('DOMContentLoaded', renderPanel, { once: true });
  window.addEventListener('pagehide', () => { stopLocationPlayback(); setNetworkSimulation('normal'); }, { once: true });
}
