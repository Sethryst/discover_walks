import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHistorySite,
  isMuseumSite,
  splitHistorySites,
  packProgress,
  rectangleFromBbox,
  fillForRemaining,
  learnHistoryHtml
} from '../js/learn-history.js';

const museum = { id: 'm1', name: 'Fairfax Museum', lat: 38.84, lng: -77.3, tags: ['history', 'history_museum'] };
const marker = { id: 'h1', name: 'A historic marker', lat: 38.85, lng: -77.31, tags: ['history'] };
const park = { id: 'p1', name: 'A county park', lat: 38.86, lng: -77.32, tags: ['park'] };

test('Learn keeps museums and history sites only', () => {
  assert.equal(isHistorySite(museum), true);
  assert.equal(isMuseumSite(museum), true);
  assert.equal(isHistorySite(marker), true);
  assert.equal(isHistorySite(park), false);
});

test('Learn splits checked history from sites still to discover', () => {
  const split = splitHistorySites([museum, marker, park], { visitedPoiIds: ['m1'] });
  assert.equal(split.total, 2);
  assert.deepEqual(split.seen.map((item) => item.id), ['m1']);
  assert.deepEqual(split.remaining.map((item) => item.id), ['h1']);
});

test('Learn pack progress counts remaining sites', () => {
  const progress = packProgress([museum, marker], { visitedPoiIds: ['m1'] });
  assert.equal(progress.visited, 1);
  assert.equal(progress.remaining, 1);
  assert.equal(progress.total, 2);
});

test('Learn pack splits use a closed bounding box', () => {
  const box = rectangleFromBbox({ west: -77.6, south: 38.6, east: -77.0, north: 39.0 });
  assert.equal(box.length, 4);
  assert.deepEqual(box[0], [38.6, -77.6]);
});

test('Learn fill gets darker when more sites remain', () => {
  const empty = fillForRemaining(0);
  const full = fillForRemaining(1);
  assert.match(empty, /rgba\(45, 114, 89, 0\.08\)/);
  assert.match(full, /rgba\(45, 114, 89, 0\.3/);
});

test('Learn HTML names the two views', () => {
  const html = learnHistoryHtml({
    progress: { visited: 1, remaining: 1, total: 2 },
    view: 'discover',
    sites: [marker]
  });
  assert.match(html, /Still to discover/);
  assert.match(html, /History/);
  assert.match(html, /A historic marker/);
  assert.doesNotMatch(html, /NEAREST STORY/);
});
