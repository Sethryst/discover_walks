export const OBSERVATION_ASPECTS = Object.freeze(['presence', 'absence', 'need']);
export const OBSERVATION_LIFECYCLE = Object.freeze(['active', 'encountered', 'completed', 'historical', 'corrected', 'retracted']);

export function buildObservationRecord({
  id,
  city,
  aspect = 'presence',
  category = 'other',
  title,
  note = '',
  personalTags = [],
  icon = 'camera',
  photo = null,
  location,
  createdAt = new Date().toISOString(),
  walkId = null,
  gpsAccuracy = null,
  coverage = null,
  confidence = 'observed',
  visibility = 'private'
} = {}) {
  if (!id || !title || !location) throw new Error('An observation needs an id, title, and location.');
  const safeAspect = OBSERVATION_ASPECTS.includes(aspect) ? aspect : 'presence';
  return {
    schemaVersion: 2,
    id,
    type: 'observation',
    aspect: safeAspect,
    category: String(category || 'other'),
    lifecycle: 'historical',
    city,
    species: title,
    title,
    note,
    personalTags: [...new Set(personalTags.filter(Boolean).map((tag) => String(tag).toLowerCase()))],
    icon,
    photo,
    location: { lat: location.lat, lng: location.lng, ...(Number.isFinite(gpsAccuracy ?? location.accuracy) ? { accuracy: gpsAccuracy ?? location.accuracy } : {}) },
    createdAt,
    observedAt: createdAt,
    walkId,
    visibility,
    confidence,
    coverage,
    evidence: {
      source: 'first-person',
      capturedAt: createdAt,
      locationCaptured: true,
      gpsAccuracyMeters: Number.isFinite(gpsAccuracy ?? location.accuracy) ? gpsAccuracy ?? location.accuracy : null,
      routeContextWalkId: walkId,
      photoAttached: Boolean(photo),
      claimScope: safeAspect === 'absence' ? 'not-observed-within-recorded-coverage' : safeAspect === 'need' ? 'personal-need-at-recorded-time-and-place' : 'observed-at-recorded-time-and-place'
    },
    corrections: [],
    supersededBy: null,
    retractedAt: null,
    searchableText: [title, note, safeAspect, category, ...personalTags].filter(Boolean).join(' ').toLowerCase()
  };
}

export function correctObservation(record, correction) {
  if (!record?.id || !correction?.id) throw new Error('A correction requires both record ids.');
  return {
    ...record,
    lifecycle: 'corrected',
    supersededBy: correction.id,
    corrections: [...(record.corrections || []), { observationId: correction.id, timestamp: correction.createdAt || new Date().toISOString() }]
  };
}

export function retractObservation(record, reason = '', at = new Date().toISOString()) {
  if (!record?.id) throw new Error('An observation is required.');
  return { ...record, lifecycle: 'retracted', retractedAt: at, retractionReason: reason };
}

export function observationFreshness(record, now = Date.now()) {
  const observed = new Date(record?.observedAt || record?.createdAt || 0).getTime();
  const ageDays = Number.isFinite(observed) ? Math.max(0, (now - observed) / 86400000) : Infinity;
  const category = record?.category || '';
  const fastChanging = new Set(['water', 'trash', 'restroom', 'lighting', 'trail-condition']);
  const staleAfterDays = fastChanging.has(category) ? 30 : 180;
  return { ageDays, staleAfterDays, stale: ageDays > staleAfterDays };
}
