export const LOCATION_PRESETS = {
  alexandria: { name: 'Alexandria, VA', lat: 38.8048, lng: -77.0469 },
  dc: { name: 'Washington, DC', lat: 38.8951, lng: -77.0364 },
  pgcounty: { name: "Prince George's County, MD", lat: 38.8315, lng: -76.8465 },
  fairfax: { name: 'Fairfax County, VA', lat: 38.8462, lng: -77.3064 }
};
const simulatorEnabled = typeof location !== 'undefined' && (location.hostname === 'localhost' || new URLSearchParams(location.search).has('devtools'));
const STORAGE_KEY = 'walk-wildlife-simulated-location';
let simulatedPreset = simulatorEnabled ? sessionStorage.getItem(STORAGE_KEY) : null;
let nextWatchId = 0;
const watches = new Map();
export function simulatedPosition(preset) { const point = LOCATION_PRESETS[preset]; if (!point) throw new Error(`Unknown location preset: ${preset}`); return { coords: { latitude: point.lat, longitude: point.lng, accuracy: 10 }, timestamp: Date.now() }; }
export function isLocationSimulatorEnabled() { return simulatorEnabled; }
export function isSimulationActive() { return simulatorEnabled && Boolean(simulatedPreset); }
export function clearSimulation() { simulatedPreset = null; if (simulatorEnabled) sessionStorage.removeItem(STORAGE_KEY); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('location-updated', { detail: null })); }
export function getCurrentPosition(success, error) { if (isSimulationActive()) return success(simulatedPosition(simulatedPreset)); return navigator.geolocation.getCurrentPosition(success, error, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }); }
export function watchPosition(success, error, options) { if (!isSimulationActive()) return navigator.geolocation.watchPosition(success, error, options); const id = ++nextWatchId; watches.set(id, setInterval(() => success(simulatedPosition(simulatedPreset)), 5000)); queueMicrotask(() => success(simulatedPosition(simulatedPreset))); return id; }
export function clearWatch(id) { if (watches.has(id)) { clearInterval(watches.get(id)); watches.delete(id); } else navigator.geolocation.clearWatch(id); }
function dispatchPosition() { window.dispatchEvent(new CustomEvent('location-updated', { detail: simulatedPosition(simulatedPreset) })); }
function renderPanel() {
  if (!simulatorEnabled) return;
  const panel = document.createElement('aside'); panel.id = 'locationSimulatorPanel'; panel.className = 'location-simulator-panel';
  panel.innerHTML = `<strong>Location simulator</strong><span class="simulator-warning">SIMULATED LOCATION</span><label>Preset<select id="locationSimulatorPreset">${Object.entries(LOCATION_PRESETS).map(([id, point]) => `<option value="${id}">${point.name}</option>`).join('')}</select></label><div class="simulator-actions"><button type="button" id="useSimulatedLocationButton">Use simulated location</button><button type="button" id="moveSimulatedLocationButton">Move location</button><button type="button" id="clearSimulatedLocationButton">Clear simulation</button></div><output id="locationSimulatorCoordinates">No simulation active</output><small>Accuracy: <span id="locationSimulatorAccuracy">—</span></small>`;
  document.body.append(panel); const select = panel.querySelector('#locationSimulatorPreset'); select.value = simulatedPreset || 'dc';
  const update = () => { const point = isSimulationActive() ? LOCATION_PRESETS[simulatedPreset] : null; panel.querySelector('#locationSimulatorCoordinates').textContent = point ? `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}` : 'No simulation active'; panel.querySelector('#locationSimulatorAccuracy').textContent = point ? '10 m' : '—'; document.body.classList.toggle('simulated-location-active', Boolean(point)); };
  const activate = () => { simulatedPreset = select.value; sessionStorage.setItem(STORAGE_KEY, simulatedPreset); dispatchPosition(); update(); };
  panel.querySelector('#useSimulatedLocationButton').onclick = activate; panel.querySelector('#moveSimulatedLocationButton').onclick = activate;
  panel.querySelector('#clearSimulatedLocationButton').onclick = () => { clearSimulation(); update(); };
  update();
}
if (simulatorEnabled) window.addEventListener('DOMContentLoaded', renderPanel, { once: true });
