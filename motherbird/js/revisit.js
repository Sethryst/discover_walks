import { distanceMeters } from './geo.js';
import { state } from './state.js';
import db from './storage.js';
import { el, escapeHtml } from './utils.js';
import { openSheet } from './ui.js';

const REVISIT_DISTANCE_METERS = 65;
const MIN_REVISIT_AGE_MS = 6 * 60 * 60 * 1000;
let lastRefresh = { at: 0, position: null };
let currentRevisit = null;

function validLocation(value) {
  return value && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng));
}

export function timeOfDay(date) {
  const hour = new Date(date).getHours();
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

export function seasonForDate(date) {
  const month = new Date(date).getMonth();
  if (month <= 1 || month === 11) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'autumn';
}

export function buildRevisitCandidates({ walks = [], personalPlaces = [], memories = [] } = {}) {
  const candidates = [];
  for (const place of personalPlaces) {
    if (!validLocation(place.location)) continue;
    const history = Array.isArray(place.visitHistory) ? place.visitHistory : [];
    candidates.push({
      id: `personal:${place.id}`,
      sourceId: place.id,
      kind: place.state === 'candidate' ? 'personal-landmark' : 'saved-place',
      name: place.name || 'A personal landmark',
      location: place.location,
      lastVisitedAt: history.at(-1)?.visitedAt || place.lastObservedAt || place.added || place.createdAt || null,
      futureSelfNote: place.futureSelfNote || place.notes || '',
      visits: history
    });
  }
  for (const walk of walks) {
    const points = [walk.startLocation || walk.points?.[0], walk.endLocation || walk.points?.at(-1)].filter(validLocation);
    points.forEach((location, index) => candidates.push({
      id: `walk:${walk.id}:${index}`,
      sourceId: walk.id,
      kind: 'prior-walk-location',
      name: index ? 'A place from a previous walk' : 'A previous walk starting point',
      location,
      lastVisitedAt: walk.endedAt || walk.savedAt || walk.startedAt,
      futureSelfNote: walk.futureSelfNote || '',
      visits: [{ visitedAt: walk.endedAt || walk.startedAt, walkId: walk.id }]
    }));
  }
  for (const memory of memories) {
    if (!validLocation(memory.location)) continue;
    candidates.push({
      id: `memory:${memory.id}`, sourceId: memory.id, kind: 'saved-place', name: memory.name || 'A remembered place',
      location: memory.location, lastVisitedAt: memory.lastVisitDate, futureSelfNote: memory.futureSelfNote || memory.lastNote || '', visits: memory.visits || []
    });
  }
  return candidates;
}

export function matchMeaningfulRevisits(position, candidates = [], { now = new Date(), thresholdMeters = REVISIT_DISTANCE_METERS } = {}) {
  if (!validLocation(position)) return [];
  const nowMs = now.getTime();
  return candidates.map((candidate) => ({ ...candidate, distanceMeters: distanceMeters(position, candidate.location) }))
    .filter((candidate) => candidate.distanceMeters <= thresholdMeters)
    .filter((candidate) => !candidate.lastVisitedAt || nowMs - new Date(candidate.lastVisitedAt).getTime() >= MIN_REVISIT_AGE_MS)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || new Date(b.lastVisitedAt || 0) - new Date(a.lastVisitedAt || 0));
}

export function standoutObservation(candidate, observations = [], thresholdMeters = 90) {
  if (!candidate?.location) return null;
  return observations.filter((item) => validLocation(item.location) && distanceMeters(candidate.location, item.location) <= thresholdMeters)
    .sort((a, b) => {
      const richness = (item) => (item.photo ? 3 : 0) + (item.note ? 2 : 0) + (item.species || item.title ? 1 : 0);
      return richness(b) - richness(a) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    })[0] || null;
}

export function seasonalComparison(lastVisitedAt, now = new Date()) {
  if (!lastVisitedAt) return null;
  const previous = new Date(lastVisitedAt);
  const previousSeason = seasonForDate(previous); const currentSeason = seasonForDate(now);
  const previousTime = timeOfDay(previous); const currentTime = timeOfDay(now);
  if (previousSeason !== currentSeason) return `Then: ${previousSeason}. Now: ${currentSeason}.`;
  if (previousTime !== currentTime) return `Last time was ${previousTime}; this return is ${currentTime}.`;
  return `Another ${currentSeason} ${currentTime} — notice what stayed and what changed.`;
}

export function revisitSummary(candidate, observations = [], now = new Date()) {
  const observation = standoutObservation(candidate, observations);
  return {
    ...candidate,
    observation,
    comparison: seasonalComparison(candidate.lastVisitedAt, now),
    lastVisitLabel: candidate.lastVisitedAt ? new Date(candidate.lastVisitedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Saved for a future walk'
  };
}

export async function refreshNearbyRevisit(position = state.currentPosition, { force = false } = {}) {
  const panel = el('revisitPromptCard');
  if (!panel || !validLocation(position)) return null;
  const now = Date.now();
  if (!force && lastRefresh.position && now - lastRefresh.at < 20000 && distanceMeters(position, lastRefresh.position) < 25) return currentRevisit;
  lastRefresh = { at: now, position: { lat: position.lat, lng: position.lng } };
  const [observations, memories] = await Promise.all([db.all('observations'), db.all('poi_metadata')]);
  const matches = matchMeaningfulRevisits(position, buildRevisitCandidates({ walks: state.walks, personalPlaces: state.personalPlaces, memories }));
  currentRevisit = matches[0] ? revisitSummary(matches[0], observations) : null;
  panel.classList.toggle('hidden', !currentRevisit);
  if (!currentRevisit) return null;
  const observation = currentRevisit.observation;
  panel.innerHTML = `<span>FROM YOUR JOURNAL</span><strong>${escapeHtml(currentRevisit.name)} is nearby</strong><p>Last here: ${escapeHtml(currentRevisit.lastVisitLabel)}.${observation ? ` You noticed ${escapeHtml(observation.species || observation.title || observation.note || 'something worth keeping')}.` : ''}</p>${currentRevisit.futureSelfNote ? `<small>A note you left for yourself: “${escapeHtml(currentRevisit.futureSelfNote)}”</small>` : ''}<button type="button" id="openRevisitHistoryButton">See this place over time</button>`;
  el('openRevisitHistoryButton')?.addEventListener('click', openCurrentRevisitHistory, { once: true });
  return currentRevisit;
}

export function openCurrentRevisitHistory() {
  if (!currentRevisit) return;
  const target = el('revisitHistoryContent');
  const visits = [...(currentRevisit.visits || [])].sort((a, b) => new Date(b.visitedAt || b.timestamp || 0) - new Date(a.visitedAt || a.timestamp || 0));
  target.innerHTML = `<p class="revisit-comparison">${escapeHtml(currentRevisit.comparison || 'Notice what feels familiar and what has changed.')}</p>${currentRevisit.observation ? `<article><span>STANDOUT OBSERVATION</span><strong>${escapeHtml(currentRevisit.observation.species || currentRevisit.observation.title || 'Something you noticed')}</strong><p>${escapeHtml(currentRevisit.observation.note || 'Saved in your journal.')}</p></article>` : ''}<ol>${visits.length ? visits.map((visit) => `<li><time>${escapeHtml(new Date(visit.visitedAt || visit.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</time>${visit.note ? `<p>${escapeHtml(visit.note)}</p>` : ''}</li>`).join('') : '<li>Your deeper visit history will grow gently as you return.</li>'}</ol>`;
  el('revisitHistoryTitle').textContent = currentRevisit.name;
  openSheet('revisitHistorySheet');
}

export function initRevisitExperience() {
  window.addEventListener('personal-places-changed', () => void refreshNearbyRevisit(state.currentPosition, { force: true }));
}
