import { test, expect } from '@playwright/test';

const url = process.env.MOTHERBIRD_SMOKE_URL || 'https://sethryst.github.io/discover_walks/';
const deadline = 30_000;
const startupBudgetMs = 10_000;

test('fresh Pages context reaches startup-ready and responds to core controls', async ({ page }) => {
  const uncaught = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') uncaught.push(message.text()); });
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}canary=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => page.evaluate(() => globalThis.__MOTHERBIRD_STARTUP__?.stages?.some((stage) => stage.stage === 'startup-ready')), { timeout: deadline }).toBe(true);
  const startupDuration = await page.evaluate(() => { const stages = globalThis.__MOTHERBIRD_STARTUP__?.stages || []; return stages.find((stage) => stage.stage === 'startup-ready')?.elapsedMs || Infinity; });
  expect(startupDuration, `startup-ready exceeded ${startupBudgetMs}ms`).toBeLessThanOrEqual(startupBudgetMs);
  expect(uncaught, `uncaught browser errors: ${uncaught.join(' | ')}`).toEqual([]);
  await expect(page.locator('#appSplash')).toHaveClass(/app-splash--done/, { timeout: 5_000 });
  await page.locator('#libraryTab').click();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await expect(page.locator('.primary-nav')).toHaveCSS('background-color', 'rgb(20, 38, 29)');
  await expect(page.locator('#primaryPanel')).toHaveCSS('color', 'rgb(16, 35, 26)');
  await expect(page.getByRole('button', { name: 'My Workspace', exact: true })).toBeVisible();
  await expect(page.locator('#saveWalkPlanButton')).toHaveText('View in workspace');
  await page.locator('#meTab').click();
  await expect(page.getByRole('heading', { name: 'Me' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForTimeout(100);
  if (await page.locator('#regionalNavigationMenu').evaluate((node) => node.classList.contains('hidden'))) {
    await page.locator('#regionalNavigation').click();
  }
  await expect(page.locator('#regionalNavigationMenu')).toBeVisible();
  await page.locator('#mapSearchInput').fill('park');
  await expect(page.locator('#mapSearchResults button').first()).toBeVisible({ timeout: deadline });
  await expect(page.locator('#radialWalkButton')).toBeVisible();
  await expect(page.locator('#ambientRouteAlternatives')).toBeAttached();
});
