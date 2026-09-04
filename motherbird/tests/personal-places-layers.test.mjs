import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { flattenImportedFilters, parseFilterImport } from '../js/layer-system.js';
import { normalizePersonalCategory, normalizePersonalPlace, samePersonalPlace, slugifyCategory, childMapFolders, countMapFolderPlaces, mapsLibraryHtml } from '../js/personal-places.js';

test('personal place records normalize to a small, local, category-linked contract', () => {
  assert.equal(slugifyCategory('  Filipino Spots!  '), 'filipino-spots');
  assert.deepEqual(normalizePersonalCategory({ name: 'Mexican Food', icon: 'utensils', color: '#E8740F' }, '2026-08-29T12:00:00.000Z'), {
    id: 'mexican-food', name: 'Mexican Food', description: '', icon: 'utensils', color: '#E8740F', parentId: null, created: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z'
  });
  const place = normalizePersonalPlace({ id: 'one', name: 'Maria\'s Tacos', category: 'mexican-food', location: { lat: 38.9072, lng: -77.0369 }, notes: 'Al pastor' }, '2026-08-29T12:00:00.000Z');
  assert.equal(place.categoryId, 'mexican-food');
  assert.equal(place.state, 'saved');
  assert.equal(place.private, true);
  assert.throws(() => normalizePersonalPlace({ name: 'Impossible', location: { lat: 190, lng: 1 } }), /valid location/);
});

test('duplicate detection is location-based and conservative', () => {
  const first = { location: { lat: 38.9072, lng: -77.0369 } };
  assert.equal(samePersonalPlace(first, { location: { lat: 38.90725, lng: -77.0369 } }), true);
  assert.equal(samePersonalPlace(first, { location: { lat: 38.9080, lng: -77.0369 } }), false);
});

test('walkfilter parsing validates the version and preserves mergeable selections', () => {
  const payload = parseFilterImport(JSON.stringify({
    export_format: 'walk-wildlife-filters-v1',
    filters: {
      park_infrastructure: { bench: { enabled: false }, drinking_water: { enabled: true } },
      personal_places: { 'mexican-food': { enabled: true } }
    },
    personal_places_data: []
  }));
  assert.deepEqual(flattenImportedFilters(payload.filters), {
    public: { bench: false, drinking_water: true },
    personal: { 'mexican-food': true }
  });
  assert.throws(() => parseFilterImport('{\"export_format\":\"unknown\"}'), /compatible JSON export/);
});

test('My maps folders nest like Learn parent folders', () => {
  const parks = normalizePersonalCategory({ name: 'Parks', color: '#2d7259' }, '2026-09-04T00:00:00.000Z');
  const trails = normalizePersonalCategory({ name: 'Trails', parentId: parks.id, color: '#2d7259' }, '2026-09-04T00:00:00.000Z');
  const categories = [parks, trails];
  const places = [
    normalizePersonalPlace({ id: 'p1', name: 'Meadowlark', categoryId: parks.id, location: { lat: 38.9, lng: -77.2 } }, '2026-09-04T00:00:00.000Z'),
    normalizePersonalPlace({ id: 'p2', name: 'W&OD', categoryId: trails.id, location: { lat: 38.91, lng: -77.21 } }, '2026-09-04T00:00:00.000Z')
  ];
  assert.deepEqual(childMapFolders(null, categories).map((item) => item.id), ['parks']);
  assert.deepEqual(childMapFolders('parks', categories).map((item) => item.id), ['trails']);
  assert.equal(countMapFolderPlaces('parks', categories, places), 2);
  const home = mapsLibraryHtml({ categories, places, openFolderId: null, visibleFilters: {} });
  assert.match(home, /data-maps-folder="parks"/);
  assert.match(home, /learn-kicker">Folders/);
  assert.doesNotMatch(home, /data-maps-folder="trails"/);
  const open = mapsLibraryHtml({ categories, places, openFolderId: 'parks', visibleFilters: { parks: true } });
  assert.match(open, /data-maps-back="1"/);
  assert.match(open, /data-maps-folder="trails"/);
  assert.match(open, /Meadowlark/);
});

test('the PWA exposes persistent layers, personal places, and non-destructive import controls', async () => {
  const [html, storage, worker] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/storage.js', import.meta.url), 'utf8'),
    readFile(new URL('../service-worker.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(html, /data-explore-tab=\"personal\"/);
  assert.match(html, /id=\"savePlaceMapButton\"/);
  assert.match(html, /id=\"personalPlaceForm\"/);
  assert.match(html, /id=\"joinModeSelect\"/);
  assert.match(html, /Replace pack extras \\(never private journal\\)/);
  assert.match(storage, /indexedDB\\.open\\('walk-wildlife-journal', 11\\)/);
  assert.match(storage, /personal_place_categories/);
  assert.match(storage, /layer_settings/);
  assert.match(worker, /\\.\\/js\\/layer-system\\.js/);
  assert.match(worker, /\\.\\/js\\/icon-loader\\.js/);
  assert.match(worker, /\\.\\/icons\\/water-fountain\\.svg/);
});
