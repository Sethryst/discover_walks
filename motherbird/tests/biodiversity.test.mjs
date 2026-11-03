import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { normalizeOccurrences, validateBiodiversitySidecar } from '../tools/normalize-biodiversity.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../regions/alexandria-va/biodiversity/records.json', import.meta.url)));

test('candidate contract and public-source provenance', () => {
  assert.equal(validateBiodiversitySidecar(fixture), true);
  assert.match(fixture.metadata.sourceAccess, /GBIF/);
  for (const record of fixture.records) { assert.equal('decimalLatitude' in record, false); assert.equal('decimalLongitude' in record, false); }
});

test('privacy and aggregation filters remain safe at build time', () => {
  const result = normalizeOccurrences([{ occurrenceID: 'open', decimalLatitude: 1, decimalLongitude: 1, coordinateUncertaintyInMeters: 10, eventDate: '2026-05-01', taxonID: 'a', scientificName: 'A' }, { occurrenceID: 'obscured', decimalLatitude: 1, decimalLongitude: 1, coordinateUncertaintyInMeters: 10, eventDate: '2026-05-01', taxonID: 'b', scientificName: 'B', geoprivacy: 'obscured' }], { regionId: 'r' });
  assert.equal(result.records.length, 2); assert.ok(result.records.every((record) => !('decimalLatitude' in record) && !('decimalLongitude' in record)));
});

test('field guide uses live open/open public observations and no handoff export', async () => {
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8'); const js = await fs.readFile(new URL('../js/biodiversity.js', import.meta.url), 'utf8');
  assert.match(html, /Nature recorded here/); assert.doesNotMatch(html, /Download handoff/); assert.doesNotMatch(js, /buildEncounterExport|inaturalist-encounter/); assert.match(js, /geoprivacy: 'open'/); assert.match(js, /taxon_geoprivacy: 'open'/); assert.match(js, /mappable: 'true'/); assert.match(js, /markerPinHtml/); assert.match(js, /L\.marker/);
});

test('regional navigation provides a viewport-aware iNaturalist link', async () => {
  const js = await fs.readFile(new URL('../js/regional-navigation.js', import.meta.url), 'utf8'); assert.match(js, /Explore hotspots on iNaturalist/); assert.match(js, /getBounds/); assert.match(js, /swlat/); assert.match(js, /nelng/);
});

test('live Nature categories are part of Recreation advanced filters', async () => {
  const js = await fs.readFile(new URL('../js/layer-system.js', import.meta.url), 'utf8');
  assert.match(js, /id: 'biodiversity', light: 'recreation'/);
  assert.match(js, /biodiversity:birds/);
  assert.match(js, /biodiversity-live-updated/);
  assert.match(js, /biodiversity-filters-changed/);
});
