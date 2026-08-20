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

test('primary modes and personal counters are visible without collection-style totals', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const profile = await readFile(new URL('../js/profile.js', import.meta.url), 'utf8');
  assert.match(html, />Discover<\/button>/);
  assert.match(html, />Guide<\/button>/);
  assert.match(html, />Journal<\/button>/);
  assert.match(html, /What are you looking at\?/);
  assert.match(profile, /observations.*walks.*places remembered/);
  assert.doesNotMatch(profile, /cityDiscoveries.*\/.*totalCitySites/);
  assert.doesNotMatch(profile, /Discover every stop/);
});
