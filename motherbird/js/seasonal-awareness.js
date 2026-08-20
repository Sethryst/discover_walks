/**
 * Shared contract for time-aware Field Edition intelligence.
 * Specialists contribute evidence; this module owns the common shape so
 * wildlife, weather, habitat, and future editors do not invent calendars.
 */
export const AWARENESS_SPECIALISTS = Object.freeze(['time', 'weather', 'habitat']);
export const WALKER_ACTIONS = Object.freeze(['look', 'listen', 'rest', 'explore', 'take_a_detour']);
export const CONFIDENCE_LEVELS = Object.freeze(['confirmed', 'likely', 'possible']);

export function createSeasonalAwareness(input) {
  const item = {
    id: required(input.id, 'id'),
    place: normalizePlace(input.place),
    significance: normalizeSignificance(input.significance),
    walkerActions: normalizeActions(input.walkerActions),
    confidence: requiredEnum(input.confidence, CONFIDENCE_LEVELS, 'confidence'),
    sources: normalizeSources(input.sources),
    contributedBy: requiredEnum(input.contributedBy, AWARENESS_SPECIALISTS, 'contributedBy'),
    collectedAt: validDate(input.collectedAt, 'collectedAt')
  };
  return Object.freeze(item);
}

function normalizePlace(place = {}) {
  const coordinates = place.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) throw new Error('place.coordinates must be [longitude, latitude].');
  return Object.freeze({ name: required(place.name, 'place.name'), category: required(place.category, 'place.category'), coordinates, geometry: place.geometry || null });
}

function normalizeSignificance(value = {}) {
  return Object.freeze({
    seasonalReason: required(value.seasonalReason, 'significance.seasonalReason'),
    weatherCondition: value.weatherCondition || null,
    timeWindow: required(value.timeWindow, 'significance.timeWindow')
  });
}

function normalizeActions(actions = []) {
  if (!Array.isArray(actions) || !actions.length) throw new Error('walkerActions must contain at least one action.');
  return Object.freeze(actions.map((action) => requiredEnum(action, WALKER_ACTIONS, 'walkerActions')));
}

function normalizeSources(sources = []) {
  if (!Array.isArray(sources) || !sources.length) throw new Error('sources must contain provenance.');
  return Object.freeze(sources.map((source) => Object.freeze({
    name: required(source.name, 'source.name'), url: required(source.url, 'source.url'), collectedAt: validDate(source.collectedAt, 'source.collectedAt'), license: required(source.license, 'source.license')
  })));
}

function required(value, name) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`); return value.trim(); }
function requiredEnum(value, allowed, name) { if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}.`); return value; }
function validDate(value, name) { if (!value || Number.isNaN(Date.parse(value))) throw new Error(`${name} must be an ISO date.`); return new Date(value).toISOString(); }
