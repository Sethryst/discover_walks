import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DISCOVER_GROUPS, discoverGroupFor, publishingState, rankDiscoverPlaces } from '../js/discovery-taxonomy.js';

test('Discover turns source tags into four human experience categories', () => {
  assert.deepEqual(DISCOVER_GROUPS.map(({ label }) => label), ['Places to Explore', 'History & Heritage', 'Art & Culture', 'Food & Community']);
  assert.equal(discoverGroupFor({ category: 'history', tags: ['history_marker'] }).id, 'heritage');
  assert.equal(discoverGroupFor({ category: 'coffee', source: 'OpenStreetMap' }).id, 'community');
});

test('Discover prioritizes curated records without rejecting useful OSM places', () => {
  const osmCoffee = { id: 'osm-cafe', name: 'Corner Cafe', category: 'coffee', source: 'OpenStreetMap' };
  const featuredPark = { id: 'park', name: 'River Park', category: 'park', featured: true };
  assert.equal(publishingState(osmCoffee), 'published');
  assert.deepEqual(rankDiscoverPlaces([osmCoffee, featuredPark]).map(({ id }) => id), ['park', 'osm-cafe']);
});

test('Field Guide joins pack-authored cards to real pins and orders from a fix', async () => {
  const guide = await readFile(new URL('../js/field-guide.js', import.meta.url), 'utf8');
  assert.doesNotMatch(guide, /FIELD_GUIDE_SUBJECTS/);
  assert.match(guide, /poiById\.has/);
  assert.match(guide, /sortGuideCardsByDistance/);
  assert.match(guide, /Location is off, so this stays in pack order/);
});

test('the idle map replaces primary tabs with Journal, Backpack, Places +, and map lights', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="journalButton"[^>]*aria-label="Open journal"/);
  assert.match(html, /id="settingsButton"[^>]*aria-label="Backpack"/);
  assert.match(html, /id="savePlaceMapButton"[^>]*>.*Places \+/);
  assert.match(html, /id="mapLights" aria-label="Map lights"/);
  assert.match(html, /id="homeCityButton"/);
  assert.match(html, /id="locateButton"/);
  assert.match(html, /id="walkButton"/);
  assert.doesNotMatch(html, /<nav class="bottom-nav"/);
  assert.doesNotMatch(html, /id="filtersButton"/);
  assert.doesNotMatch(html, /class="map-key"/);
  assert.doesNotMatch(html, /id="weatherBrief"/);
});

test('the Journal has local capture and a scrollable history without export chrome', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="observeButton"/);
  assert.match(html, /id="journalNearbyButton"/);
  assert.match(html, /id="journalTranscribeButton"/);
  assert.match(html, /id="journalRecordButton"/);
  assert.doesNotMatch(html, /id="shareJournalButton"/);
  assert.match(html, /id="journalSheet"/);
  assert.match(html, /id="journalNavDropdown"/);
  assert.match(html, /id="journalHistoryList"/);
  assert.match(html, /id="openFileInput"/);
  assert.doesNotMatch(html, /id="verifiedPlacesOnly"/);
  assert.doesNotMatch(html, /id="fieldEditionStatus"/);
});

test('Backpack opens the viewport Field Guide first and keeps quieter tools in the pack', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const profile = await readFile(new URL('../js/profile.js', import.meta.url), 'utf8');
  const guide = await readFile(new URL('../js/field-guide.js', import.meta.url), 'utf8');
  const explore = await readFile(new URL('../js/explore.js', import.meta.url), 'utf8');
  const planner = await readFile(new URL('../js/planner.js', import.meta.url), 'utf8');
  assert.match(html, /id="backpackSheet"/);
  assert.match(html, /<h2 id="backpackTitle">Field Guide<\/h2>/);
  assert.match(html, /data-guide-tab="maps"/);
  assert.match(html, /Advanced filters/);
  assert.doesNotMatch(guide, /seasonNote/);
  assert.match(guide, /sortGuideCardsByDistance/);
  assert.match(guide, /state\.currentPosition \|\| state\.lastPosition/);
  assert.doesNotMatch(guide, /In this guide:/);
  assert.match(guide, /stopPlaceIds/);
  assert.doesNotMatch(profile, /cityDiscoveries.*\/.*totalCitySites/);
  assert.doesNotMatch(profile, /Discover every stop/);
  assert.doesNotMatch(html, /Total trail points/);
  assert.doesNotMatch(html, /Walk pts/);
  assert.doesNotMatch(html, /Your first walk earns a milestone/);
  assert.doesNotMatch(html, />Leaderboard</);
  assert.match(explore, /not enough reviewed local material/);
  assert.doesNotMatch(planner, /Try a shorter loop/);
  assert.match(planner, /routeOnFoot/);
  assert.match(planner, /coordinates: routed\.ok \? routed\.coordinates : \[\]/);
});
