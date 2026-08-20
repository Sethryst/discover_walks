import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCandidate, buildContextCandidate, buildAutomationPipeline, MAX_DEFAULT_SECTIONS } from '../tools/refresh-appalachian-corridor-lab.mjs';

const line = Array.from({ length: 501 }, (_, index) => [-78 + index * .015, 39 + index * .015]);

test('Appalachian Corridor Lab keeps an oversized source line review-only and bounded', () => {
  const candidate = buildCandidate({ centerline: { features: [{ geometry: { type: 'LineString', coordinates: line } }] }, parking: { features: [] }, vistas: { features: [] }, retrievedAt: '2026-08-20T00:00:00.000Z' });
  assert.equal(candidate.status, 'lab-review-only');
  assert.ok(candidate.routes.length <= MAX_DEFAULT_SECTIONS);
  assert.ok(candidate.routes.every((route) => route.publishingState === 'candidate' && route.reviewRequired));
  assert.ok(candidate.graduationChecklist.includes('editor sign-off'));
});

test('Appalachian automation keeps region finding, entry evidence, source reconciliation, and promotion separate', () => {
  const official = [{ id: 'official-entry', kind: 'entry', name: 'Official lot', coordinates: [-77.98, 39.11], source: { name: 'NPS / Appalachian Trail Conservancy facilities' } }];
  const osm = [{ id: 'osm-park', kind: 'park', name: 'OSM park', coordinates: [-77.981, 39.11], source: { name: 'OpenStreetMap contributors' } }];
  const routeParking = { features: [{ geometry: { type: 'Point', coordinates: [-77.98, 39.11] }, properties: { OBJECTID: 1, Name: 'Official parking' } }] };
  const pipeline = buildAutomationPipeline({ official, osm, routeParking, sourceErrors: [] });
  assert.equal(pipeline.regionFinder.state, 'complete');
  assert.equal(pipeline.entryFinder.state, 'corridor-review');
  assert.equal(pipeline.entryFinder.verifiedEntryCount, 0);
  assert.equal(pipeline.nearbyDiscovery.state, 'review-ready');
  assert.equal(pipeline.sourceReconciliation.nearbyCrossSourceMatches.length, 1);
  assert.equal(pipeline.promotionQueue[0].state, 'hold');
});

test('Appalachian Corridor Lab combines official and OSM intake without auto-publishing events or access claims', () => {
  const official = { features: [{ geometry: { type: 'Point', coordinates: [-77.98, 39.11] }, properties: { OBJECTID: 7, Name: 'Trailhead lot' } }] };
  const context = buildContextCandidate({
    parking: official, vistas: official, shelters: { features: [] }, campsites: { features: [] },
    osm: { elements: [{ type: 'node', id: 9, lat: 39.12, lon: -77.97, tags: { name: 'Nearby hamlet', place: 'hamlet' } }] },
    retrievedAt: '2026-08-20T00:00:00.000Z'
  });
  assert.equal(context.status, 'lab-review-only');
  assert.equal(context.entryAreas.length, 1);
  assert.equal(context.discoveries.official.length, 2);
  assert.equal(context.discoveries.osm.length, 1);
  assert.ok([...context.discoveries.official, ...context.discoveries.osm].every((item) => item.publishingState === 'candidate' && item.reviewRequired));
  assert.ok(context.eventSources.every((item) => item.publishingState === 'source-only' && item.url.startsWith('https://')));
  assert.ok(context.volunteerSources.every((item) => item.publishingState === 'source-only' && item.url.startsWith('https://')));
});
