import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { federalBoundaryStyle, resolveFederalRegionLabel, visibilityAtZoom } from '../js/federal-boundaries.js';

const shape = (west, south, east, north) => ({ type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const feature = (id, type, name, geometry, extra = {}) => ({ type: 'Feature', id, properties: { boundary_id: id, boundary_type: type, name, ...extra }, geometry });
const virginia = feature('us-state:51', 'state', 'Virginia', shape(-84, 36, -75, 40));
const county = feature('us-county:51:059', 'county', 'Fairfax County', shape(-78, 38, -77, 39));
const district = feature('us-cd:119:51:08', 'congressional_district', '8', shape(-78, 38, -77, 39), { district: '08', congress: 119 });
const enabled = { state: true, county: true, congressional_district: true };

test('zoom policy suppresses counties below zoom 6 without changing the session toggle', () => {
  assert.deepEqual(visibilityAtZoom(enabled, 5), { state: true, county: false, congressional_district: true });
  assert.deepEqual(visibilityAtZoom(enabled, 6), { state: true, county: true, congressional_district: true });
  assert.equal(enabled.county, true);
});

test('pastel styles retain readable defaults and honor the opacity slider', () => {
  const stateStyle = federalBoundaryStyle('state', 22);
  const countyStyle = federalBoundaryStyle('county', 15);
  const districtStyle = federalBoundaryStyle('congressional_district', 100);
  assert.equal(stateStyle.fillOpacity, 0.22);
  assert.equal(countyStyle.fillOpacity, 0.15);
  assert.equal(districtStyle.fillOpacity, 1);
  assert.equal(new Set([stateStyle.fillColor, countyStyle.fillColor, districtStyle.fillColor]).size, 3);
  assert.ok(stateStyle.weight < 2);
});

test('center resolution formats a congressional label and follows visible-layer priority', () => {
  const features = [virginia, county, district];
  assert.equal(resolveFederalRegionLabel(features, [-77.5, 38.5], { enabled, zoom: 6 }), 'Virginia’s 8th District');
  assert.equal(resolveFederalRegionLabel(features, [-77.5, 38.5], { enabled: { ...enabled, congressional_district: false }, zoom: 6 }), 'Fairfax County, Virginia');
  assert.equal(resolveFederalRegionLabel(features, [-77.5, 38.5], { enabled, zoom: 5 }), 'Virginia’s 8th District');
});

test('DC neighborhood identity wins over every federal layer', () => {
  const neighborhoods = { type: 'FeatureCollection', features: [feature('dc-n-1', 'neighborhood', 'Capitol Hill', shape(-77.1, 38.8, -76.9, 39))] };
  assert.equal(resolveFederalRegionLabel([virginia, district], [-77.05, 38.9], { enabled, zoom: 7, neighborhoods }), 'Capitol Hill, DC');
});

test('federal overlay stays available offline but is temporarily unmounted from map boot', async () => {
  const [mapSource, worker] = await Promise.all([
    readFile(new URL('../js/map.js', import.meta.url), 'utf8'),
    readFile(new URL('../service-worker.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(mapSource, /initFederalBoundaries\(\)/);
  assert.match(worker, /federal-boundaries\.js/);
  assert.match(worker, /federal-region-loader\.js/);
  assert.match(worker, /federal-region-progress\.js/);
  assert.match(worker, /poi-visit-tracking\.js/);
});
