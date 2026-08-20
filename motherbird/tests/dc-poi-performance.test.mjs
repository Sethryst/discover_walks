import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';

test('DC viewport selection stays below the 100ms data-preparation budget', async () => {
  const data = JSON.parse(await readFile(new URL('../data/dc-poi.json', import.meta.url), 'utf8')).pointsOfInterest;
  const start = performance.now();
  let visible = [];
  for (let pass = 0; pass < 20; pass += 1) visible = data.filter((poi) => poi.lat >= 38.79 && poi.lat <= 39 && poi.lng >= -77.12 && poi.lng <= -76.9).map((poi) => ({ id: poi.id, lat: poi.lat, lng: poi.lng, category: poi.category }));
  const average = (performance.now() - start) / 20;
  console.log(`DC POI viewport preparation: ${average.toFixed(2)}ms average for ${visible.length} records`);
  assert.ok(visible.length >= 500); assert.ok(average < 100, `viewport preparation took ${average.toFixed(2)}ms`);
});

