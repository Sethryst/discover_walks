import { test, expect } from '@playwright/test';

const url = process.env.MOTHERBIRD_SMOKE_URL || 'http://127.0.0.1:4174/';
const ready = async (page) => expect.poll(
  () => page.evaluate(() => globalThis.__MOTHERBIRD_STARTUP__?.stages?.some((stage) => stage.stage === 'startup-ready')),
  { timeout: 30_000 }
).toBe(true);

test.use({
  serviceWorkers: 'block',
  geolocation: { latitude: 38.8338858, longitude: -77.0482543 },
  permissions: ['geolocation']
});

test('empty composer keeps one draft through place-role edits, inspection, and reload', async ({ page }) => {
  await page.goto(`${url}?outing-empty=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.locator('#radialWalkButton').click();
  await expect(page.getByRole('heading', { name: 'Compose an outing' })).toBeVisible();
  await expect(page.locator('.outing-empty')).toContainText('canvas is open');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-context-requested', { detail: { lat: 38.89, lng: -77.08 } })));
  await expect(page.locator('.outing-map-actions')).toBeVisible();
  await expect(page.locator('[data-outing-item]')).toHaveCount(0);
  await page.locator('.leaflet-popup-close-button').click();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('outing-place-action', { detail: { place: { id: 'park-1', name: 'Small Park', lat: 38.89, lng: -77.08 }, role: 'possible-stop' } })));
  const item = page.locator('[data-outing-item]');
  await expect(item).toHaveCount(1);
  const draftId = await page.evaluate(async () => (await import('./js/storage.js')).default.get('walk_drafts', 'outing-draft:active').then((draft) => draft.draftId));
  await item.locator('[data-outing-role]').selectOption('destination');
  await expect(item.locator('[data-outing-role]')).toHaveValue('destination');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.locator('#radialWalkButton').click();
  await expect(page.locator('[data-outing-item]')).toContainText('Small Park');
  await expect(page.locator('[data-outing-item] [data-outing-role]')).toHaveValue('destination');
  await expect.poll(() => page.evaluate(async () => (await import('./js/storage.js')).default.get('walk_drafts', 'outing-draft:active').then((draft) => draft.draftId))).toBe(draftId);
});

test('route consequences, explicit branching, and destination-free start stay linked', async ({ page }) => {
  await page.goto(`${url}?outing-route=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.evaluate(async () => {
    const composer = await import('./js/outing-composer.js');
    composer.setOutingRouteProvider(async (points) => ({
      ok: true,
      coordinates: points.map((point) => [Number(point.lat), Number(point.lng)]),
      distanceMeters: 1320,
      durationSeconds: 1020,
      graphVersion: 'browser-fixture',
      cellId: 'fixture-cell',
      edgeIds: ['edge-a'],
      instructions: [{ text: 'Continue through the places you chose.', distance_m: 1320 }]
    }));
  });
  await page.locator('#radialWalkButton').click();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('outing-place-action', { detail: { place: { id: 'a', name: 'First place', lat: 38.8338, lng: -77.0482 }, role: 'possible-stop' } }));
    window.dispatchEvent(new CustomEvent('outing-place-action', { detail: { place: { id: 'b', name: 'Second place', lat: 38.8348, lng: -77.0508 }, role: 'pass-through' } }));
  });
  await expect(page.locator('[data-outing-item]')).toHaveCount(2);
  await page.locator('[data-outing-preview]').click();
  await expect(page.locator('[data-outing-distance]')).toHaveText('1320 m');
  await expect(page.locator('[data-outing-duration]')).toHaveText('17 min walking');
  await expect(page.locator('[data-outing-status]')).toContainText('Time and distance are consequences');

  await page.locator('[data-outing-branch]').click();
  await expect.poll(() => page.evaluate(async () => (await (await import('./js/storage.js')).default.all('walk_drafts')).filter((draft) => draft.schema === 'outing-draft/v1').length)).toBe(2);

  await page.locator('[data-outing-item]').first().locator('[data-outing-remove]').click();
  await page.locator('[data-outing-item]').first().locator('[data-outing-remove]').click();
  await expect(page.locator('[data-outing-item]')).toHaveCount(0);
  await page.locator('[data-outing-start]').click();
  await expect(page.locator('#radialWalkLabel')).toHaveText('Pause walk');
  await expect(page.locator('#radialPauseButton')).toBeVisible();
  const readLinks = () => page.evaluate(async () => {
      const storage = (await import('./js/storage.js')).default;
      const draft = await storage.get('walk_drafts', 'outing-draft:active');
      const recording = await storage.get('walk_drafts', 'active-walk');
      return { draftWalkId: draft.activeWalkId, draftId: draft.draftId, recordedWalkId: recording.walk.id, outingDraftId: recording.walk.outingDraftId };
    });
  await expect.poll(async () => (await readLinks()).draftWalkId).not.toBeNull();
  const links = await readLinks();
  expect(links.draftWalkId).toBe(links.recordedWalkId);
  expect(links.outingDraftId).toBe(links.draftId);
});
