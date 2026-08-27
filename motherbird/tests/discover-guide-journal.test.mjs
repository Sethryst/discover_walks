import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DISCOVER_GROUPS, discoverGroupFor, publishingState, rankDiscoverPlaces } from '../js/discovery-taxonomy.js';
import { FIELD_GUIDE_SUBJECTS } from '../js/field-guide.js';

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

test('Field Guide subjects are educational records with explicit HTTPS knowledge sources', () => {
  assert.ok(FIELD_GUIDE_SUBJECTS.length >= 6);
  for (const subject of FIELD_GUIDE_SUBJECTS) {
    assert.ok(subject.cue.length > 30);
    assert.match(subject.sourceUrl, /^https:\/\//);
    assert.ok(subject.sourceName);
    assert.ok(!('lat' in subject) && !('lng' in subject));
  }
});

test('primary navigation keeps Walk, Discover, and Journal clear while Discover owns its three lenses', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, />Discover<\/button>/);
  assert.match(html, />Journal<\/button>/);
  assert.match(html, /data-view="map" title="Walk"/);
  assert.match(html, /data-discover-lens="fieldGuide"/);
  assert.match(html, /data-discover-lens="vote"/);
  assert.match(html, /data-discover-lens="volunteer"/);
  assert.match(html, /Notice wildlife, plants, history, architecture, and art/);
  assert.doesNotMatch(html, /data-view="vote"/);
  assert.doesNotMatch(html, /data-view="volunteer"/);
});

test('the active map keeps a persistent journal with embedded contextual tools', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(html, /id="persistentJournal" data-sheet-state="half"/);
  assert.match(html, /id="quickJournalForm"/);
  assert.match(html, /id="composerPhotoButton"/);
  assert.match(html, /id="addObservationButton"/);
  assert.match(html, /id="composerNearbyButton"/);
  assert.match(styles, /grid-template-columns: minmax\(0, 7fr\) minmax\(310px, 3fr\)/);
  assert.match(styles, /data-sheet-state="collapsed"/);
  assert.match(styles, /data-sheet-state="expanded"/);
});

test('Guide is a season-and-place-aware companion, while Journal avoids collection language', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const profile = await readFile(new URL('../js/profile.js', import.meta.url), 'utf8');
  const guide = await readFile(new URL('../js/field-guide.js', import.meta.url), 'utf8');
  const explore = await readFile(new URL('../js/explore.js', import.meta.url), 'utf8');
  const planner = await readFile(new URL('../js/planner.js', import.meta.url), 'utf8');
  assert.match(html, /What are you looking at\?/);
  assert.match(guide, /seasonNote/);
  assert.match(guide, /In this guide:/);
  assert.match(profile, /observations.*walks.*places remembered/);
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
