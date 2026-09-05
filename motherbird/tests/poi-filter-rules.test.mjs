import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_FILTER_TAGS, applyRegionFilterTags, assignPoiHome } from '../js/poi-filter-rules.js';

test('unknown region categories fall back to the home community tag', () => {
  const tags = applyRegionFilterTags({ category: 'accessibility', type: 'pharmacy' }, []);
  assert.ok(tags.includes('community'));
  assert.ok(HOME_FILTER_TAGS.includes('community'));
});

test('historic and park categories keep their own filter tags', () => {
  const memorial = applyRegionFilterTags({ category: 'memorial' }, []);
  assert.ok(memorial.includes('history'));
  const park = applyRegionFilterTags({ category: 'park' }, ['park']);
  assert.ok(park.includes('park'));
  assert.equal(park.includes('community'), false);
});

test('region route and water types map to known filter tags', () => {
  const route = applyRegionFilterTags({ category: 'route', type: 'footway' }, []);
  assert.ok(route.includes('trail'));
  const well = applyRegionFilterTags({ type: 'Well' }, []);
  assert.ok(well.includes('water'));
});

test('every migrated place gets a home pack id', () => {
  assert.equal(assignPoiHome({ id: 'x' }, 'boston'), 'boston');
  assert.equal(assignPoiHome({ home: 'fairfax' }, 'boston'), 'fairfax');
});
