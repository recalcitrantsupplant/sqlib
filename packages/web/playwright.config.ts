import { defineConfig, devices } from '@playwright/test';
import { WEB_BASE_URL } from './tests/e2e/web-port';
import { API_BASE_URL } from './tests/e2e/api-origin';

export default defineConfig({
  testDir: './tests/e2e',

  /*
   * File-level parallelism only: tests within a spec still run in order, so the
   * specs that share module-level fixture state keep working. Turning on
   * fullyParallel as well was measured at 109.3s against 108.1s — no gain for
   * the extra risk, because the suite is 24 files and packs fine at file
   * granularity.
   */
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,

  /*
   * Three workers on the CI runner's 2 vCPU. Measured on a 2-core cgroup
   * (`taskset -c 0,1`, which reproduced CI's 3.3m almost exactly), 234 tests:
   *
   *     workers=1  219s   <- the old setting
   *     workers=2  130s
   *     workers=3  108s   <- clean twice
   *     workers=4   99s   flaked in backend-deletion / library-backend-edit
   *     workers=6  114s   slower AND flaked
   *
   * The suite is wait-bound rather than CPU-bound, so it oversubscribes well
   * up to a point; past 3 the sleep-heavy specs (see the waitForTimeout calls
   * in backend-deletion-reference-cleanup.spec.ts) start losing their races
   * under contention, and the 4s it buys is not worth a red build.
   *
   * Playwright's own default is cores/2, which is 1 on the runner — hence
   * setting it explicitly. PW_WORKERS overrides for one-off experiments.
   */
  workers: Number(process.env.PW_WORKERS ?? (process.env.CI ? 3 : 1)),
  reporter: 'list',
  timeout: 60000,
  use: {
    baseURL: WEB_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    /*
     * The preview server this suite runs against (below) now ships a real
     * service worker (#131). Blocking it is the same reasoning as always
     * running against a fresh context: a SW registered by an earlier test is
     * a form of state leaking across tests that nothing here is meant to
     * exercise, and devOptions.enabled: false already keeps it out of `pnpm
     * dev`.
     */
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        /*
         * `PW_CHROMIUM_PATH` — run against a Chromium this machine already has.
         *
         * Playwright downloads a browser build pinned to its own version, and a
         * sandbox that ships a different one leaves the suite unrunnable for a
         * reason that has nothing to do with the code under test. Unset, which
         * is the normal case and CI's, nothing changes.
         */
        ...(process.env.PW_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],

  /*
   * The production preview, not the dev server.
   *
   * The dev server re-optimises Vite dependencies the first time a page pulls
   * in new imports, which invalidates the module graph mid-run and serves a
   * 500 for dynamically imported pages. The preview build has no on-demand
   * compilation and is deterministic — which the visual baselines require and
   * the rest of the suite benefits from.
   *
   * Locally an already-running `pnpm preview` is reused, so the build cost is
   * paid once rather than per run. In CI the workspace has already been built
   * topologically (scripts/ci/build.sh), so only the server is started —
   * building again here would repeat two minutes of work.
   *
   * The port comes from WEB_PORT (see tests/e2e/web-port.ts) and is inherited
   * by `npm run preview` through the environment.
   */
  webServer: {
    command: process.env.CI ? 'npm run preview' : 'npm run build && npm run preview',
    url: WEB_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 600000,
    /*
     * ETL and the SRL rule-tuples extension are both off by default, and specs
     * cover both. This covers the local path, where the line above also does
     * the build; CI builds in a separate step and sets the same flags at job
     * scope in ci.yml. The two have to agree: with ssr:false the flags are
     * baked into the client bundle at build time, so a spec that opens the
     * tuples toggle fails locally against a bundle built without it.
     */
    env: {
      // Baked into the bundle like the flags below; see tests/e2e/api-origin.ts.
      NUXT_PUBLIC_API_BASE_URL: API_BASE_URL,
      NUXT_PUBLIC_FEATURE_ETL: 'true',
      NUXT_PUBLIC_FEATURE_PLAYGROUND_ETL: 'true',
      NUXT_PUBLIC_FEATURE_RULE_TUPLES: 'true',
    },
  },
});
