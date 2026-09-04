// Isolated browser proof: synthetic tiles, real IndexedDB/OPFS/WebGL/service worker.
// No credentials and no cloud writes. Optional Playwright installation required.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_NODE_MODULES ? require(path.join(process.env.PLAYWRIGHT_NODE_MODULES, 'playwright')) : require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.tmp', 'sealed-offline-proof');
await mkdir(output, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  try { const body = await readFile(target); response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' }); response.end(body); }
  catch { response.writeHead(404); response.end(); }
}).listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let page;
const errors = [], warnings = [], failedRequests = [];
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PROOF_BROWSER_CHANNEL || 'chrome', args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  // No backend or third-party tile traffic from this test profile.
  await context.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  page = await context.newPage();
  const until = async (check) => {
    const deadline = Date.now() + 30000;
    while (!await page.evaluate(check)) {
      if (Date.now() > deadline) throw new Error(`Browser proof timed out: ${check}`);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  };
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (['error','warning'].includes(message.type())) warnings.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(new URL(request.url()).pathname));
  await page.goto(origin, { waitUntil: 'load' });
  await until(async () => !!(await import('/js/state.js')).state.map);
  const installation = await page.evaluate(async () => {
    const { generateProofArchive, PROOF_LOCATION } = await import('/tests/fixtures/pmtiles-proof.mjs');
    const { regionInstaller } = await import('/js/region-ui.js');
    const { state } = await import('/js/state.js');
    const { activateInstalledBasemap } = await import('/js/map.js');
    const { bytes, bounds } = generateProofArchive(pmtiles.zxyToTileId);
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    await regionInstaller.install({ id: 'fairfax-county-va', name: 'SYNTHETIC PROOF — no real coverage', pmtilesBlob: new Blob([bytes]), manifest: { checksums: { 'fairfax-county-va.pmtiles': `sha256:${sha256}` }, geographicBounds: { west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3] } } });
    state.regionAutomation = { ...await regionInstaller.load('fairfax-county-va'), activeRegionId: 'fairfax-county-va' };
    state.map.setView([PROOF_LOCATION.lat, PROOF_LOCATION.lng], 15);
    if (!await activateInstalledBasemap(state.regionAutomation)) throw new Error('Basemap activation failed');
    return { sha256, bytes: bytes.length, synthetic: true };
  });
  await until(async () => (await import('/js/state.js')).state.installedBasemapMap?.loaded());
  const onlineFeatures = await page.evaluate(async () => (await import('/js/state.js')).state.installedBasemapMap.queryRenderedFeatures().length);
  assert.ok(onlineFeatures > 0, 'Real MVT geometry must render online');
  await page.locator('#settingsButton').click();
  await page.locator('[data-guide-tab="online"]').click();
  await page.locator('#offlineMenuButton').click();
  await page.locator('[data-seal-class="offline"]').check();
  await until(() => document.querySelector('#offlineTileStatus').textContent.includes('On-device tile verified'));
  assert.equal(await page.locator('input[name="offlinePreset"]').first().inputValue(), 'dark-satellite');
  await page.locator('input[name="offlinePreset"][value="field-paper"]').check();
  await page.locator('input[name="offlinePreset"][value="dark-satellite"]').check();
  await page.locator('#offlineModePreview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'online-mobile.png') });
  await page.locator('#saveOfflineViewButton').click();
  await until(async () => (await import('/js/state.js')).state.settings.viewConditions?.preset === 'dark-satellite');
  await until(() => document.querySelector('#offlineModePreview').classList.contains('hidden'));
  // Await actual service-worker control before the cold, disconnected reload.
  await until(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  // Also stop the origin, so cached boot cannot pass on a transport-emulation
  // quirk. Set the offline UI signal explicitly: installed Chrome can continue
  // reporting onLine=true when a service worker is present under emulation.
  await new Promise(resolve => server.close(resolve));
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false }));
  await page.reload({ waitUntil: 'load' });
  await until(async () => (await import('/js/state.js')).state.installedBasemapMap?.loaded());
  const offline = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    const { regionInstaller } = await import('/js/region-ui.js');
    const { probeInstalledTile } = await import('/js/installed-tiles.js');
    const { buildSelectedBackup } = await import('/js/sealed-data.js');
    const { importSealKey, sealJson, openSealedJson } = await import('/js/cloud-journal.js');
    const view = state.settings.viewConditions;
    const file = await regionInstaller.opfs.readFile('regions/fairfax-county-va/fairfax-county-va.pmtiles');
    const oldFetch = window.fetch; let fetchCalls = 0;
    window.fetch = () => { fetchCalls++; throw new Error('No network allowed'); };
    try {
      const proof = await probeInstalledTile(file, { ...view.range.center, zoom: view.zoom });
      const payload = await buildSelectedBackup({}, { offline: true }, view);
      const key = await importSealKey(crypto.getRandomValues(new Uint8Array(32)));
      const envelope = await sealJson(payload, key, 'personal:isolated-proof');
      const restored = await openSealedJson(envelope, key, 'personal:isolated-proof');
      return { proof, fetchCalls, online: navigator.onLine, view: state.offlineView, restored: restored.viewConditions, renderedFeatures: state.installedBasemapMap.queryRenderedFeatures().length, preset: state.installedBasemapMap.getStyle().metadata.offlinePreset };
    } finally { window.fetch = oldFetch; }
  });
  assert.equal(offline.online, false); assert.equal(offline.fetchCalls, 0);
  assert.ok(offline.renderedFeatures > 0, 'Real MVT geometry must render after offline reload');
  assert.equal(offline.preset, 'dark-satellite'); assert.deepEqual(offline.restored, offline.view);
  await page.locator('#settingsButton').click();
  await page.locator('[data-guide-tab="online"]').click();
  await page.locator('#offlineMenuButton').click();
  // Checked settings persist, and opening the section should restore its preview.
  assert.ok(await page.locator('#offlineModePreview').isVisible(), 'Saved Offline selection must reopen its preview');
  await until(() => document.querySelector('#offlineTileStatus').textContent.includes('On-device tile verified'));
  await page.locator('#offlineModePreview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'offline-mobile.png') });
  assert.deepEqual(errors, []);
  const report = { generatedAt: new Date().toISOString(), installation, onlineFeatures, offline, originServerStopped: true, navigatorOfflineSignalSimulated: true, browserErrors: errors, limitations: ['Synthetic single tile, not regional map generation or real coverage', 'Offline transport enforced by stopping the origin server; navigator.onLine flag simulated', 'No live Supabase RPC, journal_backups write, hardware PRF, audio/camera, or two-account test'] };
  await writeFile(path.join(output, 'proof.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...installation, onlineFeatures, offlineFeatures: offline.renderedFeatures, offlineTile: offline.proof, fetchCalls: offline.fetchCalls, originServerStopped: true, navigatorOfflineSignalSimulated: true, browserErrors: errors }, null, 2));
  console.log(`Screenshots and receipt: ${output}`);
} catch (error) {
  console.error(JSON.stringify({ errors, warnings, failedRequests }, null, 2));
  if (page) console.error(await page.evaluate(async () => { const { state } = await import('/js/state.js'); return { activeCity: state.activeCity, hasMap: !!state.map, hasInstalledMap: !!state.installedBasemapMap, view: state.offlineView, region: state.regionAutomation?.activeRegionId }; }).catch(() => 'App modules unavailable'));
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
