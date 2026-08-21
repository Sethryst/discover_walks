import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfile } from '../js/utils.js';
import { FederalRegionProgress } from '../js/federal-region-progress.js';
import { resolveFederalRegion } from '../js/federal-boundaries.js';

test('profile normalization upgrades historic discoveries into general POI visits', () => {
  const profile = normalizeProfile({ sitesDiscovered: { vienna: ['site-a', 'site-a'], dc: ['site-b'] }, visitedPoiIds: ['poi-c'] });
  assert.deepEqual(new Set(profile.visitedPoiIds), new Set(['site-a', 'site-b', 'poi-c']));
});

test('federal progress intersects tagged region POIs with local visits', async () => {
  const tracker = new FederalRegionProgress('/regions', { fetchImpl: async () => new Response(JSON.stringify({ schemaVersion: 1, artifactType: 'federal-region-poi-progress', regions: { 'us-cd:119:51:11': { total: 3, poiIds: ['a', 'b', 'c'] } } })) });
  assert.deepEqual(await tracker.forRegion('us-cd:119:51:11', { visitedPoiIds: ['b', 'outside'] }), { visited: 1, total: 3 });
});

test('region resolver returns the stable ID used by the progress index', () => {
  const geometry = { type: 'Polygon', coordinates: [[[-78, 38], [-77, 38], [-77, 39], [-78, 39], [-78, 38]]] };
  const features = [{ type: 'Feature', properties: { boundary_id: 'us-state:51', boundary_type: 'state', name: 'Virginia' }, geometry }, { type: 'Feature', properties: { boundary_id: 'us-cd:119:51:11', boundary_type: 'congressional_district', district: '11' }, geometry }];
  assert.deepEqual(resolveFederalRegion(features, [-77.5, 38.5], { enabled: { state: true, county: true, congressional_district: true }, zoom: 5 }), { label: 'Virginia’s 11th District', regionId: 'us-cd:119:51:11' });
});
