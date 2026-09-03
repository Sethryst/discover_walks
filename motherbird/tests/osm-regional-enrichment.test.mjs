import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CITIES } from '../js/constants.js';
import { isOsmPoi, poiMatchesSelectedTags } from '../js/poi.js';
import { normalizeRegionDataConfig } from '../js/osm-regions.js';
import { contextualNearbyPlaces } from '../js/journal-pane.js';

const built = ['alexandria-va', 'arlington-va', 'baltimore', 'boise-meridian-idaho', 'boston', 'boulder', 'chicago', 'columbus', 'corpus-christi', 'denver', 'detroit', 'fairfax-county-va', 'falls-church-va', 'fort-worth', 'keystone-colorado', 'los-angeles', 'loudoun-county-va', 'new-orleans', 'norfolk', 'nyc', 'philadelphia', 'pittsburgh', 'portland', 'portland-maine', 'prince-georges-county-md', 'richmond', 'san-francisco', 'santa-fe', 'seattle', 'sedona-arizona', 'tempe', 'washington-dc', 'wolf-trap-va'];

test('every frontend region has explicit canonical OSM status', () => {
  assert.equal(Object.keys(CITIES).length, 34);
  assert.equal(CITIES['wolf-trap-va'], undefined);
  assert.equal(CITIES.fairfax.dataFile, './regions/fairfax-county-va/pois.json');
  for (const [id, city] of Object.entries(CITIES)) {
    const config = normalizeRegionDataConfig(id, city);
    assert.ok(['enabled', 'unavailable'].includes(config.osm.status));
    assert.equal(config.osm.enabled, config.osm.status === 'enabled');
    assert.ok(config.osm.enabled ? config.osm.packageFile : config.osm.unavailableReason);
    assert.ok(config.supplementalPoiFiles.every((file) => !/\/osm\//.test(file)));
  }
});

test('published runtime OSM packages are attributed, unique, and checksum-valid', async () => {
  for (const regionId of built) {
    const base = new URL(`../regions/${regionId}/osm/`, import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
    const artifact = JSON.parse(await readFile(new URL('pois.json', base), 'utf8'));
    const ids = new Set();
    for (const poi of artifact.pois) {
      assert.match(poi.id, /^osm:(node|way|relation):\d+$/);
      assert.ok(!ids.has(poi.id)); ids.add(poi.id);
      assert.equal(isOsmPoi(poi), true);
      assert.equal(poi.source[0].attribution, '© OpenStreetMap contributors');
      assert.equal(poi.source[0].license, 'ODbL-1.0');
      assert.equal(poiMatchesSelectedTags(poi, new Set(['osm'])), true);
    }
    for (const [name, expected] of Object.entries(manifest.checksums)) {
      const bytes = await readFile(new URL(name, base));
      assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, expected);
    }
  }
});

test('service worker includes shared OSM module and every enabled package contract', async () => {
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /\.\/js\/osm-regions\.js/);
  for (const artifact of ['pois.json', 'manifest.json', 'validation.json', 'spatial-index-delta.json', 'attribution.json']) assert.match(worker, new RegExp(artifact.replace('.', '\\.')));
  assert.doesNotMatch(await readFile(new URL('../js/quiet-places.js', import.meta.url), 'utf8'), /overpass-api|fetch\(/);
});

test('Nearby keeps OSM contextual and offers journal memory', async () => {
  const osm = (id, distance) => ({ poi: { id: `osm:node:${id}`, name: `OSM ${id}`, lat: 1, lng: 1, fromOsm: true }, distance });
  const curated = (id, distance) => ({ poi: { id: `city:${id}`, name: `City ${id}`, lat: 1, lng: 1 }, distance });
  const selected = contextualNearbyPlaces([osm(1, 1), osm(2, 2), osm(3, 3), osm(4, 4), curated(1, 5), curated(2, 6), curated(3, 7)]);
  assert.equal(selected.length, 6);
  assert.equal(selected.filter(({ poi }) => isOsmPoi(poi)).length, 3);
  assert.match(await readFile(new URL('../js/journal-pane.js', import.meta.url), 'utf8'), /data-nearby-remember/);
});
