/**
 * The UAT lane: a real browser, a real API, a real store.
 *
 * Deliberately a separate config rather than a tag in the main one. Every spec
 * under `tests/e2e` mocks the API at the network layer and the config starts a
 * preview server to serve them — neither of which is any use here, because what
 * this lane exists to check is whether the *derivation* is right. A mocked
 * `/execute` would only tell you the app can render a fixture.
 *
 * So it starts nothing and assumes both halves are already up:
 *
 *     just run-local-patch-demo      # the API, seeded
 *     just run-frontend-patch-demo   # the SPA
 *     just uat-patch-demo            # this
 *
 * Serial, single worker: the specs share one store and one of them writes to
 * it, so their order is part of what they assert.
 */

import { defineConfig, devices } from '@playwright/test';

export const UAT_WEB_URL = process.env.PATCH_DEMO_WEB_URL ?? 'http://localhost:3001';
export const UAT_API_URL = process.env.PATCH_DEMO_API_URL ?? 'http://localhost:3005';

export default defineConfig({
  testDir: './tests/uat',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 60000,
  use: {
    baseURL: UAT_WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    /*
     * Playwright's own chromium by default. `PW_CHROMIUM_PATH` is for a machine
     * that cannot download one — a locked-down container, an air-gapped runner
     * — and can point at a system install instead.
     */
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
