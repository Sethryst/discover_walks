import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIONAL_POI_CATEGORIES,
  NATIONAL_POI_QUERY_LAYERS,
  nationalPoiFeatureDetails,
  nationalPoiStyle,
  nationalPoiSymbolLayers
} from '../js/national-poi-map.js';

test('OSM raster and national POIs share one MapLibre style', () => {
  const style = nationalPoiStyle('pmtiles://https://example.test/poi.pmtiles');
  assert.equal(style.sources.osmBasemap.type, 'raster');
  assert.equal(style.sources.nationalPoi.type, 'vector');
  assert.equal(style.layers[0].id, 'osm-basemap');
  assert.equal(style.layers.find((layer) => layer.id === 'national-poi-point').source, 'nationalPoi');
  assert.match(style.sources.osmBasemap.attribution, /OpenStreetMap/);
});

test('walking categories have unique icons, colors, and readable labels', () => {
  assert.equal(NATIONAL_POI_CATEGORIES.length, 13);
  assert.equal(new Set(NATIONAL_POI_CATEGORIES.map(({ id }) => id)).size, 13);
  assert.ok(NATIONAL_POI_CATEGORIES.every(({ icon, color, label }) => icon && /^#[0-9a-f]{6}$/i.test(color) && label));
  const [icons, placeLabels, lineLabels] = nationalPoiSymbolLayers();
  assert.equal(icons.id, 'national-poi-icon');
  assert.equal(placeLabels.layout['text-field'][1], 'name');
  assert.equal(lineLabels.layout['symbol-placement'], 'line');
  assert.ok(NATIONAL_POI_QUERY_LAYERS.includes('national-poi-point'));
});

test('feature details expose useful walking qualities without raw markup', () => {
  const details = nationalPoiFeatureDetails({
    name: 'Creekside Path', category: 'trail', subcategory: 'named_path', osm_type: 'way', osm_id: '42',
    osm_tags: JSON.stringify({ surface: 'compacted', wheelchair: 'limited', lit: 'no', opening_hours: 'dawn-dusk' })
  });
  assert.equal(details.name, 'Creekside Path');
  assert.equal(details.category, 'Trails');
  assert.equal(details.subcategory, 'named path');
  assert.equal(details.osmId, 'way/42');
  assert.deepEqual(details.qualities.slice(0, 3), [
    { label: 'Wheelchair', value: 'limited' },
    { label: 'Surface', value: 'compacted' },
    { label: 'Lighting', value: 'no' }
  ]);
});
