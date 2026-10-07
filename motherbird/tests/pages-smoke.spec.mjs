import { test, expect } from '@playwright/test';

const url = process.env.MOTHERBIRD_SMOKE_URL || 'https://sethryst.github.io/discover_walks/';
const deadline = 30_000;

test('fresh Pages context reaches startup-ready and responds to core controls', async ({ page }) => {
  const uncaught = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') uncaught.push(message.text()); });
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}canary=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => page.evaluate(() => globalThis.__MOTHERBIRD_STARTUP__?.stages?.some((stage) => stage.stage === 'startup-ready')), { timeout: deadline }).toBe(true);
  expect(uncaught, `uncaught browser errors: ${uncaught.join(' | ')}`).toEqual([]);
  await expect(page.locator('#appSplash')).toHaveClass(/app-splash--done/, { timeout: 5_000 });
  for (const selector of ['#libraryTab', '#meTab', '#regionalNavigation', '#mapSearchInput', '#walkButton']) {
    await expect(page.locator(selector)).toBeVisible();
    await page.locator(selector).click();
  }
});
