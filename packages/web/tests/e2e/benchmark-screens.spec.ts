import { test, expect } from '@playwright/test';
import {
  mockEntityApi,
  BACKEND,
  BENCHMARK_EXPERIMENT,
  BENCHMARK_OBSERVATIONS,
  BENCHMARK_VERSION,
  QUERY_VERSION,
  type MockOptions,
} from './fixtures/entities';

/**
 * The Plan and Runs screens.
 *
 * The claims worth guarding are the ones the screens turn on: the axes are
 * separated from the policy, the expansion arithmetic is live and matches what
 * the plan says, and one run resolves into per-request rows a person can open.
 */

const OBSERVATION_COUNT = 3;

/*
 * The default fixture names the query entity rather than a version, so the
 * plan has no query text to show. These routes pin the case and its requests
 * to the query's version, which carries the text.
 */
const fulfill = (route: import('@playwright/test').Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const PINNED_VERSION = {
  ...BENCHMARK_VERSION,
  subjectSpecs: BENCHMARK_VERSION.subjectSpecs.map((spec) => ({ ...spec, subject: QUERY_VERSION.id })),
};
const PINNED: MockOptions = {
  extraRoutes: [
    [/\/benchmark-experiments\/runs\/[^/]+\/observations$/, (r) =>
      fulfill(r, BENCHMARK_OBSERVATIONS.map((o) => ({ ...o, subject: QUERY_VERSION.id })))],
    [/\/benchmark-experiments\/[^/]+\/versions\/\d+$/, (r) => fulfill(r, PINNED_VERSION)],
    [/\/benchmark-experiments\/[^/]+\/versions$/, (r) => fulfill(r, [PINNED_VERSION])],
  ],
};

test.use({ viewport: { width: 1600, height: 900 } });

async function openBenchmark(page: import('@playwright/test').Page, options: MockOptions = {}) {
  await mockEntityApi(page, options);
  await page.goto(`/?section=benchmarks&benchmark=${encodeURIComponent(BENCHMARK_EXPERIMENT.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-testid="benchmark-plan-sidebar"]')).toBeVisible();
}

test.describe('Benchmark plan', () => {
  /*
   * The fixture is one case, one backend, no argument set, 3 repeats. An
   * unnamed axis counts as one — a plan that runs cannot print "0 requests".
   */
  test('prints the expansion, and it matches the axes', async ({ page }) => {
    await openBenchmark(page);

    const footer = page.locator('[data-testid="benchmark-expansion"]');
    await expect(footer).toContainText('3');
    await expect(footer).toContainText('requests');
    await expect(footer).toContainText('1 × 1 × 1 × 3');
  });

  // Policy never multiplies, so it sits below the divider with no + and no count.
  test('separates the axes from the settings', async ({ page }) => {
    await openBenchmark(page);

    await expect(page.locator('[data-testid="benchmark-add-cases"]')).toBeVisible();
    await expect(page.locator('[data-testid="benchmark-add-backends"]')).toBeVisible();
    // Load is one profile per version, so it has nothing to add.
    await expect(page.locator('[data-testid="benchmark-add-loadProfiles"]')).toHaveCount(0);

    for (const setting of ['failure', 'order']) {
      await expect(page.locator(`[data-testid="benchmark-setting-${setting}"]`)).toBeVisible();
    }
  });

  test('opens the case editor on the selected case', async ({ page }) => {
    await openBenchmark(page);

    const editor = page.locator('[data-testid="benchmark-case-editor"]');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('Backends');
  });

  // The case's query is drawn by the app's CodeMirror viewer, read-only.
  test('shows the case query in a read-only CodeMirror viewer', async ({ page }) => {
    await openBenchmark(page, PINNED);

    const query = page.locator('[data-testid="benchmark-case-query"]');
    await expect(query.locator('.cm-editor')).toBeVisible();
    await expect(query.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  });

  test('the expansion follows the backends axis', async ({ page }) => {
    await openBenchmark(page);

    await page.locator('[data-testid="benchmark-add-backends"]').click();
    const detail = page.locator('[data-testid="benchmark-plan-detail"]');
    await expect(detail).toContainText('Backends');

    // Unchecking the only backend leaves the axis empty, which still counts as
    // one — each case falls back to its query's default.
    const attached = detail.locator('input[type="checkbox"]').first();
    await expect(attached).toBeVisible();
    await attached.uncheck();
    await expect(page.locator('[data-testid="benchmark-expansion"]')).toContainText('1 × 1 × 1 × 3');
    expect(BACKEND.id).toBeTruthy();
  });

  test('a setting opens a form rather than a picker', async ({ page }) => {
    await openBenchmark(page);

    await page.locator('[data-testid="benchmark-setting-failure"]').click();
    const detail = page.locator('[data-testid="benchmark-plan-detail"]');
    await expect(detail).toContainText('Failure policy');
    await expect(detail).toContainText('Timeout (ms)');
    await expect(detail.locator('input[type="number"]').first()).toBeVisible();
  });
});

test.describe('Benchmark runs', () => {
  test('resolves a run into one row per request', async ({ page }) => {
    await openBenchmark(page);
    await page.locator('[data-testid="benchmark-tab-runs"]').click();

    await expect(page.locator('[data-testid="benchmark-run-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="benchmark-request-row"]')).toHaveCount(OBSERVATION_COUNT);

    // p50/p95/p99, not mean/fastest/slowest.
    await expect(page.locator('[data-testid="benchmark-run-summary"]')).toContainText('p50 · p95 · p99');
  });

  test('opens one request into its phase breakdown', async ({ page }) => {
    await openBenchmark(page);
    await page.locator('[data-testid="benchmark-tab-runs"]').click();
    await page.locator('[data-testid="benchmark-request-row"]').first().click();

    const detail = page.locator('[data-testid="benchmark-request-detail"]');
    await expect(detail).toContainText('Waiting on the store');
    await expect(detail).toContainText('Response');
  });

  // The sent query is drawn by the app's CodeMirror viewer, read-only.
  test('shows the sent query in a read-only CodeMirror viewer', async ({ page }) => {
    await openBenchmark(page, PINNED);
    await page.locator('[data-testid="benchmark-tab-runs"]').click();
    await page.locator('[data-testid="benchmark-request-row"]').first().click();

    const sent = page.locator('[data-testid="benchmark-request-sent"]');
    await expect(sent.locator('.cm-editor')).toBeVisible();
    await expect(sent.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
    await expect(sent).toContainText('SELECT ?country');
  });
});
