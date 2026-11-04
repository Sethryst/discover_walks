import { test, expect } from '@playwright/test';

const ready = async (page) => expect.poll(() => page.evaluate(() => globalThis.__MOTHERBIRD_STARTUP__?.stages?.some((stage) => stage.stage === 'startup-ready')), { timeout: 30_000 }).toBe(true);

test('real app starts, exposes local-first surfaces, and stays privacy-safe', async ({ page, context }) => {
  const personalLeak = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  page.on('request', (request) => {
    const body = request.postData() || '';
    const url = request.url();
    if (/origin|destination|journal|history|steps|route_geometry|coordinates|lat(?:itude)?|lng|lon(?:gitude)?/i.test(`${url} ${body}`) && !/127\.0\.0\.1|localhost/.test(url)) personalLeak.push(url);
  });
  const started = Date.now();
  await page.goto('/?release-qualification=1', { waitUntil: 'domcontentloaded' });
  await ready(page);
  const startupMs = Date.now() - started;
  await expect(page.locator('#appSplash')).toHaveClass(/app-splash--done/, { timeout: 5_000 });
  await expect(page.locator('#libraryTab')).toBeVisible();
  const runtime = await page.evaluate(async () => {
    const [{ getLocalRoutingCapabilities }, { getMIPCapabilities }] = await Promise.all([import('/js/local-routing-engine.js'), import('/js/mip-duckdb.js')]);
    return { routing: getLocalRoutingCapabilities(), mip: getMIPCapabilities?.() || null, serviceWorker: !!navigator.serviceWorker, online: navigator.onLine };
  });
  expect(runtime.routing.privacy).toBe('coordinates-never-leave-device');
  expect(personalLeak, `personal data appeared in non-local requests: ${personalLeak.join(', ')}`).toEqual([]);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await expect(page.locator('#libraryTab')).toBeVisible();
  await test.info().attach('qualification-metrics.json', { body: JSON.stringify({ startupMs, runtime, consoleErrors, failedRequests }, null, 2), contentType: 'application/json' });
  expect(consoleErrors.filter((error) => !/Failed to load resource/i.test(error)), 'browser console errors').toEqual([]);
});
