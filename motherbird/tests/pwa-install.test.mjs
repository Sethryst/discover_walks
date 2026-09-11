import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

test('manifest provides installable any-purpose and maskable phone icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#eeefed');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  for (const icon of manifest.icons) assert.ok((await stat(new URL(`..${icon.src.slice(1)}`, import.meta.url))).size > 1000);
});

test('the page includes iOS startup images and an in-app splash fallback', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../splash-fix.css', import.meta.url), 'utf8');
  const loader = await readFile(new URL('../js/loader.js', import.meta.url), 'utf8');
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /rel="apple-touch-startup-image"/);
  assert.match(html, /id="appSplash"/);
  assert.match(html, /splash-screen\.jpeg/);
  assert.match(html, /splash-1290x2796\.png/);
  assert.match(html, /device-height: 874px/);
  assert.match(html, /splash-fix\.css/);
  assert.match(css, /inset:0/);
  assert.match(css, /-webkit-fill-available/);
  assert.doesNotMatch(css, /html,body\{min-height:100dvh/);
  assert.doesNotMatch(css, /\.app-shell,#map/);
  assert.match(loader, /visualViewport/);
});

test('national PMTiles stay range-only while My Maps exposes persisted category controls', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  const releaseRuntime = await readFile(new URL('../js/osm-release.js', import.meta.url), 'utf8');
  const mapRuntime = await readFile(new URL('../js/map.js', import.meta.url), 'utf8');
  const nationalMapRuntime = await readFile(new URL('../js/national-poi-map.js', import.meta.url), 'utf8');
  assert.match(html, /id="nationalPoiOverlay"/);
  assert.doesNotMatch(html, /id="nationalPoiLegend"/);
  assert.match(html, /id="nationalOsmLayerControls"/);
  assert.match(worker, /if \(\/\\\.pmtiles\$\/i\.test\(url\.pathname\)\)/);
  assert.match(releaseRuntime, /new pmtilesImpl\.FetchSource/);
  assert.doesNotMatch(releaseRuntime, /national[\s\S]{0,300}response\.blob\(\)/i);
  assert.match(nationalMapRuntime, /id: 'osm-basemap'/);
  assert.match(nationalMapRuntime, /id: 'national-poi-icon'/);
  assert.match(nationalMapRuntime, /id: 'national-poi-place-label'/);
  assert.match(mapRuntime, /showNationalPoiDetails/);
});
