import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildFederalRegions } from '../tools/build-federal-regions.mjs';
import { FederalRegionLoader } from '../js/federal-region-loader.js';

test('nationwide processor versions identities, retains two Congresses, and loads only viewport shards', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'federal-regions-'));
  const source = path.join(fixture, 'source');
  const output = path.join(fixture, 'derived-regions');
  await mkdir(source, { recursive: true });
  try {
    const va = polygon(-79, 37, -77, 39);
    const pa = polygon(-80, 40, -78, 42);
    await writeGeoJson(path.join(source, 'states.geojson'), [feature('Virginia', { GEOID: '51', STATE: '51', NAME: 'Virginia' }, va), feature('Pennsylvania', { GEOID: '42', STATE: '42', NAME: 'Pennsylvania' }, pa)]);
    await writeGeoJson(path.join(source, 'counties.geojson'), [feature('Test County', { GEOID: '51001', STATE: '51', COUNTY: '001', NAME: 'Test County' }, polygon(-78.9, 37.1, -78, 38))]);
    const congressFiles = [];
    for (const congress of [119, 118, 117]) {
      const filename = path.join(source, `cd${congress}.geojson`);
      await writeGeoJson(filename, [feature('Congressional District 8', { STATE: '51', BASENAME: '8', [`CD${congress}`]: '08', NAME: 'Congressional District 8' }, polygon(-78.5, 37.5, -77.2, 38.8))]);
      congressFiles.push({ congress, filename });
    }
    await writeFile(path.join(source, 'producer-manifest.json'), JSON.stringify({
      generatedAt: '2026-08-20T20:08:46.710Z',
      artifacts: [
        { id: 'states', filename: 'states.geojson', vintage: '2025', acquisition: { method: 'bulk-cartographic' } },
        { id: 'counties', filename: 'counties.geojson', vintage: '2025', acquisition: { method: 'bulk-cartographic' } },
        { id: 'congressional-districts', filename: 'cd119.geojson', vintage: '119th-congress', acquisition: { method: 'bulk-cartographic' } }
      ]
    }));

    const manifest = await buildFederalRegions({ sourceRoot: source, outputRoot: output, congressionalSources: congressFiles });
    assert.deepEqual(manifest.congressPolicy.hot, [119, 118]);
    assert.deepEqual(Object.keys(manifest.shards.congress).sort(), ['118', '119']);
    assert.equal(manifest.counts.states, 2);
    assert.equal(manifest.counts.counties, 1);
    assert.equal(manifest.shards.congress['119'].states['51'].featureCount, 1);

    const canonical = JSON.parse(await readFile(path.join(output, 'canonical/congress/119/states/51/congressional-districts.geojson')));
    assert.equal(canonical.features[0].id, 'us-cd:119:51:08');
    assert.equal(canonical.features[0].properties.source_boundary_id.startsWith('source:'), true);

    const requests = [];
    const loader = new FederalRegionLoader('/federal', { fetchImpl: fileFetch(output, requests), cryptoImpl: webcrypto });
    const loaded = await loader.loadViewport({ bbox: [-78.8, 37.2, -77.3, 38.7], zoom: 6 });
    assert.equal(loaded.features.some((item) => item.id === 'us-state:51'), true);
    assert.equal(loaded.features.some((item) => item.id === 'us-cd:119:51:08'), true);
    assert.equal(loaded.features.some((item) => item.properties.stateFips === '42'), false);
    assert.equal(loaded.metadata.loadedShards.every((filename) => !filename.includes('/42/')), true);
    assert.equal(requests.some((url) => url.includes('/42/')), false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('zoom 8 keeps state shards and explicitly marks municipal data deferred', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'federal-regions-z8-'));
  const source = path.join(fixture, 'source'); const output = path.join(fixture, 'derived-regions');
  await mkdir(source, { recursive: true });
  try {
    const shape = polygon(-79, 37, -77, 39);
    await writeGeoJson(path.join(source, 'states.geojson'), [feature('Virginia', { GEOID: '51', STATE: '51', NAME: 'Virginia' }, shape)]);
    await writeGeoJson(path.join(source, 'counties.geojson'), [feature('County', { GEOID: '51001', STATE: '51', COUNTY: '001', NAME: 'County' }, shape)]);
    await writeGeoJson(path.join(source, 'cd.geojson'), [feature('District 8', { STATE: '51', BASENAME: '8', CD119: '08', NAME: 'District 8' }, shape)]);
    await writeFile(path.join(source, 'producer-manifest.json'), JSON.stringify({ generatedAt: '2026-08-20T20:08:46.710Z', artifacts: [
      { id: 'states', filename: 'states.geojson', vintage: '2025' }, { id: 'counties', filename: 'counties.geojson', vintage: '2025' }, { id: 'congressional-districts', filename: 'cd.geojson', vintage: '119th-congress' }
    ] }));
    await buildFederalRegions({ sourceRoot: source, outputRoot: output });
    const loader = new FederalRegionLoader('/federal', { fetchImpl: fileFetch(output, []), cryptoImpl: webcrypto });
    const loaded = await loader.loadViewport({ bbox: [-78.5, 37.5, -77.5, 38.5], zoom: 9 });
    assert.equal(loaded.metadata.municipalDeferred, true);
    assert.equal(loaded.metadata.loadedShards.every((filename) => filename.includes('/z5-7/')), true);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

function feature(name, sourceProperties, geometry) {
  return { type: 'Feature', id: `source:${sourceProperties.GEOID || sourceProperties.STATE}:${name}`, properties: { boundary_id: `source:${sourceProperties.GEOID || sourceProperties.STATE}:${name}`, name, source_properties: sourceProperties }, geometry };
}

function polygon(west, south, east, north) {
  return { type: 'Polygon', coordinates: [[[west, south], [(west + east) / 2, south + 0.001], [east, south], [east, north], [west, north], [west, south]]] };
}

async function writeGeoJson(filename, features) { await writeFile(filename, JSON.stringify({ type: 'FeatureCollection', features })); }

function fileFetch(root, requests) {
  return async (url) => {
    requests.push(String(url));
    const relative = String(url).replace(/^\/federal\/?/, '');
    try { return new Response(await readFile(path.join(root, relative)), { status: 200 }); }
    catch { return new Response('missing', { status: 404 }); }
  };
}
