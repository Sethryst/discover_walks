import { state } from './state.js';
import { distanceMeters } from './geo.js';
import { el } from './utils.js';

export const DEFAULT_COMPANION_ID = 'inky';
export const CRITICAL_COMPANION_STATES = Object.freeze(['idle', 'walk']);

// Only idle and normal walking are critical. Every other source is assigned to
// an <img> only when the corresponding state wins, which leaves contextual GIFs
// out of startup downloads while still allowing the service worker to retain a
// normally requested asset.
export const COMPANIONS = Object.freeze({
  inky: Object.freeze({
    label: 'Inky',
    states: Object.freeze({
      idle: './assets/inky-idle.gif',
      stationary: './assets/inky-stationary.gif',
      walk: './assets/inky-walk.gif',
      slow: './assets/inky-walk-slow.gif',
      run: './assets/inky-run.gif',
      sprint: './assets/inky-sprint.gif',
      rainSlow: './assets/inky-rain-walk.gif',
      rainWalk: './assets/inky-rain-walk.gif',
      rainRun: './assets/inky-rain-run.gif',
      rainSprint: './assets/inky-rain-sprint.gif',
      sunny: './assets/inky-sun-walk.gif',
      autumn: './assets/inky-autumn-walk.gif',
      map: './assets/inky-map.gif',
      discover: './assets/inky-discover.gif',
      observe: './assets/inky-observe.gif',
      journal: './assets/inky-journal.gif',
      water: './assets/inky-fishing.gif',
      night: './assets/inky-night.gif',
      finish: './assets/inky-walk-finish.gif',
      historic: './assets/inky-history.gif'
    })
  }),
  fox: Object.freeze({ label: 'Fox', states: Object.freeze({ idle: './assets/fox-idle.gif', stationary: './assets/fox-idle.gif', walk: './assets/fox-walk.gif' }) }),
  cloud: Object.freeze({ label: 'Cloud', states: Object.freeze({ idle: './assets/cloud-idle.gif', stationary: './assets/cloud-idle.gif', walk: './assets/cloud-walk.gif' }) }),
  compass: Object.freeze({ label: 'Compass', states: Object.freeze({ idle: './assets/compass.gif', stationary: './assets/compass.gif', walk: './assets/compass.gif' }) })
});

const preloadedAssets = new Map();
let transientContext = null;
let transientTimer = null;
let environment = { rain: false, sunny: false };

export function normalizeCompanionId(value) {
  const id = String(value || '').toLowerCase();
  return COMPANIONS[id] ? id : DEFAULT_COMPANION_ID;
}

export function selectedCompanionId() {
  return normalizeCompanionId(state.settings?.companionWalker);
}

export function resolvedCompanionState(companionId, requestedState = 'idle') {
  const states = COMPANIONS[normalizeCompanionId(companionId)].states;
  if (states[requestedState]) return requestedState;
  return requestedState === 'idle' || requestedState === 'stationary' ? (states.idle ? 'idle' : 'walk') : (states.walk ? 'walk' : 'idle');
}

export function companionAsset(companionId, companionState = 'idle', { fallback = true } = {}) {
  const states = COMPANIONS[normalizeCompanionId(companionId)].states;
  if (states[companionState]) return states[companionState];
  return fallback ? states[resolvedCompanionState(companionId, companionState)] || null : null;
}

export function criticalCompanionAssets(companionId) {
  return [...new Set(CRITICAL_COMPANION_STATES.map((name) => companionAsset(companionId, name)).filter(Boolean))];
}

function preloadAsset(src) {
  if (preloadedAssets.has(src)) return preloadedAssets.get(src);
  if (typeof Image === 'undefined') return Promise.resolve(src);
  const pending = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(src);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  preloadedAssets.set(src, pending);
  return pending;
}

export function preloadCompanionCritical(companionId = selectedCompanionId()) {
  return Promise.all(criticalCompanionAssets(companionId).map(preloadAsset));
}

export function paceForWalk(walk, nowMs = Date.now()) {
  const points = walk?.points || [];
  if (walk?.paused || walk?.recordingStatus !== 'recording' || points.length < 2) return null;
  const current = points.at(-1); const previous = points.at(-2);
  const currentMs = Date.parse(current.capturedAt || '') || Number(current.capturedAtMs);
  const previousMs = Date.parse(previous.capturedAt || '') || Number(previous.capturedAtMs);
  if (!Number.isFinite(currentMs) || !Number.isFinite(previousMs) || currentMs <= previousMs || nowMs - currentMs > 90000) return null;
  const metersPerSecond = distanceMeters(previous, current) / ((currentMs - previousMs) / 1000);
  if (metersPerSecond >= 3.1) return 'sprint';
  if (metersPerSecond >= 2.0) return 'run';
  if (metersPerSecond > 0 && metersPerSecond < 0.85) return 'slow';
  return 'walk';
}

function stateIsAvailable(stateName, availableStates) {
  return !availableStates || availableStates.has(stateName);
}

export function selectCompanionState({
  walk = null, pace = null, context = null, rain = false, sunny = false, now = new Date(), availableStates = null
} = {}) {
  if (walk?.recordingStatus === 'stopped' && stateIsAvailable('finish', availableStates)) return 'finish';
  const active = walk?.recordingStatus === 'recording' && !walk.paused;
  if (active) {
    const hour = now.getHours();
    if ((hour < 6 || hour >= 20) && stateIsAvailable('night', availableStates)) return 'night';
    if (rain) {
      const rainState = pace === 'sprint' ? 'rainSprint' : pace === 'run' ? 'rainRun' : pace === 'slow' ? 'rainSlow' : 'rainWalk';
      if (stateIsAvailable(rainState, availableStates)) return rainState;
    }
    for (const special of ['water', 'historic', 'observe', 'journal', 'discover', 'map']) {
      if (context === special && stateIsAvailable(special, availableStates)) return special;
    }
    if (pace === 'sprint' && stateIsAvailable('sprint', availableStates)) return 'sprint';
    if (pace === 'run' && stateIsAvailable('run', availableStates)) return 'run';
    if (pace === 'slow' && stateIsAvailable('slow', availableStates)) return 'slow';
    const month = now.getMonth();
    if (sunny && stateIsAvailable('sunny', availableStates)) return 'sunny';
    if (month >= 8 && month <= 10 && stateIsAvailable('autumn', availableStates)) return 'autumn';
    return 'walk';
  }
  if (walk && (walk.paused || walk.recordingStatus === 'recording') && stateIsAvailable('stationary', availableStates)) return 'stationary';
  return 'idle';
}

export function companionStateForWalk(walk, now = new Date()) {
  const companion = COMPANIONS[selectedCompanionId()];
  return selectCompanionState({
    walk,
    pace: paceForWalk(walk, now.getTime()),
    context: transientContext,
    rain: environment.rain,
    sunny: environment.sunny,
    now,
    availableStates: new Set(Object.keys(companion.states))
  });
}

export function setCompanionState(companionState = 'idle') {
  const companionId = selectedCompanionId();
  const companion = COMPANIONS[companionId];
  const resolvedState = resolvedCompanionState(companionId, companionState);
  const asset = companionAsset(companionId, resolvedState, { fallback: false });
  const image = el('walkCompanionImage');
  if (image && asset) {
    if (image.getAttribute('src') !== asset) image.setAttribute('src', asset);
    image.alt = '';
    image.dataset.companion = companionId;
    image.dataset.companionState = resolvedState;
  }
  return { companionId, requestedState: companionState, resolvedState, asset };
}

export function refreshCompanionState() {
  return setCompanionState(companionStateForWalk(state.activeWalk));
}

export function requestCompanionContext(context, { durationMs = 4800 } = {}) {
  transientContext = context || null;
  clearTimeout(transientTimer);
  refreshCompanionState();
  if (transientContext && durationMs > 0) transientTimer = setTimeout(() => { transientContext = null; refreshCompanionState(); }, durationMs);
}

export function setCompanionEnvironment(next = {}) {
  environment = { ...environment, rain: Boolean(next.rain), sunny: Boolean(next.sunny) };
  refreshCompanionState();
}

export function applyCompanionSettings() {
  const companionId = selectedCompanionId();
  state.settings.companionWalker = companionId;
  const companion = COMPANIONS[companionId];
  const select = el('companionWalker');
  const preview = el('companionPreviewImage');
  if (select) select.value = companionId;
  if (preview) {
    preview.src = companion.states.idle || companion.states.walk;
    preview.alt = '';
  }
  void preloadCompanionCritical(companionId);
  refreshCompanionState();
}
