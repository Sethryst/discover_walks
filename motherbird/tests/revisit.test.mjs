import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRevisitCandidates, matchMeaningfulRevisits, revisitSummary, seasonalComparison } from '../js/revisit.js';

test('meaningful revisits match saved places, personal landmarks, and prior walk locations without map clutter', () => {
  const candidates = buildRevisitCandidates({
    personalPlaces: [{ id: 'p1', name: 'Old oak', state: 'saved', location: { lat: 38.9, lng: -77.2 }, lastObservedAt: '2026-01-01T12:00:00Z', notes: 'Look for the first leaves.' }],
    walks: [{ id: 'w1', startedAt: '2026-02-01T12:00:00Z', endedAt: '2026-02-01T13:00:00Z', startLocation: { lat: 38.901, lng: -77.2 }, endLocation: { lat: 38.92, lng: -77.2 } }]
  });
  const matches = matchMeaningfulRevisits({ lat: 38.9, lng: -77.2 }, candidates, { now: new Date('2026-08-30T12:00:00Z'), thresholdMeters: 120 });
  assert.equal(matches.length, 2);
  assert.equal(matches[0].name, 'Old oak');
  assert.equal(matches[0].futureSelfNote, 'Look for the first leaves.');
});

test('revisit summary shows last visit, one standout observation, and a seasonal comparison', () => {
  const candidate = { name: 'Pond', location: { lat: 38.9, lng: -77.2 }, lastVisitedAt: '2026-01-10T09:00:00Z', visits: [] };
  const observations = [
    { id: 'plain', location: { lat: 38.9001, lng: -77.2 }, createdAt: '2026-02-01T10:00:00Z', species: 'Duck' },
    { id: 'rich', location: { lat: 38.9001, lng: -77.2 }, createdAt: '2026-01-11T10:00:00Z', species: 'Heron', note: 'Still at the reeds.', photo: 'data:image/jpeg;base64,x' }
  ];
  const summary = revisitSummary(candidate, observations, new Date('2026-08-30T14:00:00Z'));
  assert.equal(summary.observation.id, 'rich');
  assert.match(summary.comparison, /winter.*summer/i);
  assert.match(seasonalComparison('2026-08-29T09:00:00', new Date('2026-08-30T18:00:00')), /morning.*evening/i);
});
