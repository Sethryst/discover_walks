// Shared semantic place contract used by Map, Discover, Journal, and Rooms.
// It intentionally stores claims and provenance rather than pretending every
// source agrees or every historical assertion is current.
export const RELATIONSHIP_TYPES = Object.freeze([
  'contains', 'crosses', 'passes', 'near', 'follows', 'replaced', 'connected-to', 'part-of'
]);

export function normalizeSpatialPlace(input = {}) {
  const geometry = input.geometry || (Number.isFinite(Number(input.lat)) && Number.isFinite(Number(input.lng))
    ? { type: 'Point', coordinates: [Number(input.lng), Number(input.lat)] } : null);
  return {
    id: String(input.id || input.placeId || ''),
    name: String(input.name || input.title || '').trim(),
    type: String(input.type || input.category || 'place'),
    geometry,
    relationships: normalizeRelationships(input.relationships),
    temporal: normalizeTemporal(input.temporal || input.history),
    sources: normalizeSources(input.sources || input.source || input.provenance),
    provenance: input.provenance || null,
    uncertainty: input.uncertainty || null,
    freshness: input.freshness || input.updatedAt || null
  };
}

export function normalizeRelationships(value) {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item) => item && RELATIONSHIP_TYPES.includes(item.type) && item.targetId)
    .map((item) => ({ type: item.type, targetId: String(item.targetId), confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null, sourceId: item.sourceId ? String(item.sourceId) : null }));
}

export function normalizeTemporal(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter(Boolean).map((item) => ({ validFrom: item.validFrom || item.start || null, validTo: item.validTo || item.end || null, label: String(item.label || item.name || '').trim(), sourceId: item.sourceId ? String(item.sourceId) : null }));
}

export function normalizeSources(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.filter(Boolean).map((source) => typeof source === 'string' ? { id: source, name: source } : ({ id: String(source.id || source.url || source.name || 'source'), name: String(source.name || ''), url: source.url || source.officialUrl || null, license: source.license || null, retrievedAt: source.retrievedAt || null, version: source.version || null }));
}

export function addRelationship(place, relationship) {
  const normalized = normalizeSpatialPlace(place);
  return { ...normalized, relationships: normalizeRelationships([...normalized.relationships, relationship]) };
}

export function relationshipTargets(place, type) {
  return normalizeRelationships(place?.relationships).filter((item) => !type || item.type === type).map((item) => item.targetId);
}
