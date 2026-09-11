import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIONAL_OSM_LAYER_DEFAULTS, enabledNationalOsmLayerIds, nationalOsmLayerControlsHtml, normalizedNationalOsmLayers } from '../js/national-osm-layers.js';

test('first run enables only Trails and Nature', () => {
  const settings = normalizedNationalOsmLayers();
  assert.deepEqual(enabledNationalOsmLayerIds(settings).sort(), [...NATIONAL_OSM_LAYER_DEFAULTS].sort());
  for (const dense of ['crossing', 'barrier', 'transit', 'food', 'walkway']) assert.equal(settings[dense], false);
});

test('saved national OSM choices restore exactly, including intentional all-off', () => {
  const allOff = normalizedNationalOsmLayers({ categories: {} });
  assert.deepEqual(enabledNationalOsmLayerIds(allOff), []);
  const saved = normalizedNationalOsmLayers({ categories: { food: true, trail: false } });
  assert.deepEqual(enabledNationalOsmLayerIds(saved), ['food']);
});

test('My Maps controls expose group and individual category toggles', () => {
  const html = nationalOsmLayerControlsHtml(normalizedNationalOsmLayers());
  assert.match(html, /data-national-osm-toggle-all="walking"/);
  assert.match(html, /data-national-osm-layer="trail" checked/);
  assert.match(html, /data-national-osm-layer="crossing"/);
});
