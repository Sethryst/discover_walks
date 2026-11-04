import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  use: { baseURL: 'http://127.0.0.1:4174' },
  testDir: './tests',
  testMatch: /release-qualification\.spec\.mjs/,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['./tools/qualification-reporter.mjs']],
  outputDir: './test-results/qualification-artifacts',
  webServer: {
    command: 'node tools/serve-test.mjs 4174',
    url: 'http://127.0.0.1:4174/',
    reuseExistingServer: true,
    timeout: 15_000
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
    { name: 'mobile-safari-emulation', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], browserName: 'webkit' } }
  ]
});
