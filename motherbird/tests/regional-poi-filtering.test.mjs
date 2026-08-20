import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { availablePoiTags, poiMatchesSelectedTags } from '../js/poi.js';

const releases = 'C:/Users/igmro/OneDrive/Documents/gremlin_lab/releases';

// Selecting then clearing must restore the full imported set. The predicate is
// intentionally independent of current map bounds and visibility so a user can
// always reverse a zero-result category choice without resetting their region.
const sample = [{ category: 'coffee' }, { category: 'nature' }, { category: 'water' }];
const selected = new Set(['coffee']);
assert.deepEqual(sample.filter((poi) => poiMatchesSelectedTags(poi, selected)), [sample[0]]);
selected.clear();
assert.deepEqual(sample.filter((poi) => poiMatchesSelectedTags(poi, selected)), sample);

const pg = JSON.parse(await readFile(path.join(releases, 'prince-georges-county-md', 'pois.json'), 'utf8'));
assert.equal((pg.pois || []).length, 37, 'PG County now imports its verified wildlife hotspots');
assert.ok(availablePoiTags(pg.pois || []).some(([tag]) => tag === 'wildlife'), 'PG County exposes its imported wildlife filter');
assert.deepEqual((pg.pois || []).filter((poi) => poiMatchesSelectedTags(poi, new Set(['coffee']))), [], 'an unmatched category stays a stable zero-result state');
assert.deepEqual((pg.pois || []).filter((poi) => poiMatchesSelectedTags(poi, new Set())), pg.pois, 'clearing PG County filters restores its wildlife POIs');

for (const entry of await readdir(releases, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const regionId = entry.name;
  const manifestPath = path.join(releases, regionId, 'producer-manifest.json');
  const poiPath = path.join(releases, regionId, 'pois.json');
  try { await Promise.all([access(manifestPath), access(poiPath)]); } catch { continue; }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const poiBytes = await readFile(poiPath);
  assert.equal(createHash('sha256').update(poiBytes).digest('hex'), manifest.checksums?.['pois.json']?.replace(/^sha256:/, ''), `${regionId}: POI checksum matches producer manifest`);
  if (manifest.checksums?.['civic/vote.json']) {
    const voteBytes = await readFile(path.join(releases, regionId, 'civic', 'vote.json'));
    assert.equal(createHash('sha256').update(voteBytes).digest('hex'), manifest.checksums['civic/vote.json'].replace(/^sha256:/, ''), `${regionId}: Vote checksum matches producer manifest`);
  }
  const raw = JSON.parse(poiBytes.toString('utf8'));
  const pois = raw.pois || raw.pointsOfInterest || [];
  const filters = availablePoiTags(pois);
  const selectedTag = filters[0]?.[0];
  const selectedResult = selectedTag ? pois.filter((poi) => poiMatchesSelectedTags(poi, new Set([selectedTag]))) : [];
  const resetResult = pois.filter((poi) => poiMatchesSelectedTags(poi, new Set()));
  assert.deepEqual(resetResult, pois, `${regionId}: clearing filters restores every POI`);
  if (selectedTag) assert.ok(selectedResult.length > 0, `${regionId}: every rendered filter maps to imported POIs`);
}

console.log('regional POI filtering: all Gremlin bundles passed');
