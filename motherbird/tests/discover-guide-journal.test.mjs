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

test('Field Guide uses only pack-authored notices joined to viewport pins', async () => {
  const guide = await readFile(new URL('../js/field-guide.js', import.meta.url), 'utf8');
  assert.doesNotMatch(guide, /FIELD_GUIDE_SUBJECTS/);
  assert.match(guide, /poi\.notices/);
  assert.match(guide, /getBounds\(\)\.contains/);
  assert.match(guide, /classList\.toggle\('hidden', !visible\)/);
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

test('the active map owns the notice composer while idle Journal is a writing-first split', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(html, /id="persistentJournal" data-sheet-state="collapsed" aria-label="Walk notice composer"/);
  assert.match(html, /id="quickJournalForm"/);
  assert.match(html, /id="composerPhotoButton"/);
  assert.match(html, /id="addObservationButton"/);
  assert.match(html, /id="composerNearbyButton"/);
  assert.match(html, /id="composerMicButton"/);
  assert.match(styles, /\.persistent-journal \{ display: none; \}/);
  assert.match(styles, /\.walk-active \.persistent-journal/);
  assert.match(html, /id="journalSheet"/);
  assert.match(html, /id="journalArchiveSummary"/);
  assert.match(html, /id="journalOverlayArchiveList"/);
  assert.match(html, /id="layerFilterSearch"/);
  assert.match(html, /id="exportCurrentFiltersButton"/);
  assert.match(html, /id="importFilterSetButton"/);
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
  assert.match(html, /In this pack/);
  assert.match(html, /Advanced filters/);
  assert.doesNotMatch(guide, /seasonNote/);
  assert.match(guide, /getBounds\(\)\.contains/);
  assert.doesNotMatch(guide, /In this guide:/);
  assert.match(guide, /poi\.notices/);
  assert.doesNotMatch(profile, /cityDiscoveries.*\/.*totalCitySites/);
  assert.doesNotMatch(profile, /Discover every stop/);
  assert.doesNotMatch(html, /Total trail points/);
  assert.doesNotMatch(html, /Walk pts/);
  assert.doesNotMatch(html, /Your first walk earns a milestone/);
  assert.doesNotMatch(html, />Leaderboard</);
  assert.match(explore, /not enough reviewed local material/);
  assert.doesNotMatch(planner, /Try a shorter loop/);
  assert.match(planner, /Start when you’re ready/);
});
