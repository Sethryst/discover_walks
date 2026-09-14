import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIONAL_POI_CATEGORIES,
  NATIONAL_POI_QUERY_LAYERS,
  nationalPoiFeatureDetails,
  nationalPoiLayerFilters,
  nationalPoiStyle,
  nationalPoiSymbolLayers
} from '../js/national-poi-map.js';

test('OSM raster and national POIs share one MapLibre style', () => {
  const style = nationalPoiStyle('pmtiles://https://example.test/poi.pmtiles');
  assert.equal(style.sources.osmBasemap.type, 'raster');
  assert.equal(style.sources.nationalPoi.type, 'vector');
  assert.equal(style.layers[0].id, 'osm-basemap');
  assert.equal(style.layers.find((layer) => layer.id === 'national-poi-point').source, 'nationalPoi');
  const wash = style.layers.find((layer) => layer.id === 'national-poi-wash');
  assert.equal(wash.type, 'heatmap');
  assert.equal(wash.minzoom, 8);
  assert.equal(wash.maxzoom, 13);
  assert.ok(wash.paint['heatmap-opacity'].includes(12.99));
  assert.equal(nationalPoiSymbolLayers()[0].minzoom, 12);
  assert.equal(style.layers.filter(({ id }) => id === 'national-poi-wash').length, 1);
  assert.match(style.sources.osmBasemap.attribution, /OpenStreetMap/);
  const networkStyle = nationalPoiStyle('pmtiles://https://example.test/poi.pmtiles', ['trail'], 'pmtiles://https://example.test/national-walk.pmtiles');
  assert.equal(networkStyle.sources.walkNetwork.url, 'pmtiles://https://example.test/national-walk.pmtiles');
  assert.equal(networkStyle.layers.find(({ id }) => id === 'national-walk-network')['source-layer'], 'walk_network');
  assert.equal(nationalPoiStyle('pmtiles://poi', ['nature'], 'pmtiles://walk').layers.some(({ id }) => id === 'national-walk-network'), false);
});

test('category filters apply to every rendered and queryable national POI layer', () => {
  const filters = nationalPoiLayerFilters(['trail', 'nature']);
  assert.deepEqual(Object.keys(filters).sort(), [
    'national-poi-area', 'national-poi-icon', 'national-poi-line', 'national-poi-line-label', 'national-poi-place-label', 'national-poi-point',
    'national-poi-wash'
  ].sort());
  assert.ok(Object.values(filters).every((filter) => JSON.stringify(filter).includes('["trail","nature"]')));
  const style = nationalPoiStyle('pmtiles://https://example.test/poi.pmtiles', ['trail']);
  assert.match(JSON.stringify(style.layers.find(({ id }) => id === 'national-poi-point').filter), /trail/);
  assert.match(JSON.stringify(style.layers.find(({ id }) => id === 'national-poi-wash').filter), /trail/);
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
