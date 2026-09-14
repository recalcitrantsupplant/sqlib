import { defineConfig, devices } from '@playwright/test';

/**
 * Browser coverage for server-generated HTML (issue #261).
 *
 * Unlike `packages/web`'s suite, nothing here needs a dev server or a preview
 * build: every spec renders its own fixture page — the same
 * `generateDemoPage` the export route serves — to a temp file and opens it
 * with `file://`, exactly as a person who downloaded the export would. See
 * `tests/e2e/demo-page.spec.ts` for why markup-string assertions (the whole
 * rest of this package's test suite) are not enough for this file in
 * particular.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 30000,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Mirrors packages/web/playwright.config.ts: run against a Chromium
        // this machine already has rather than one pinned to Playwright's own
        // version, when the sandbox provides one.
        ...(process.env.PW_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
});
