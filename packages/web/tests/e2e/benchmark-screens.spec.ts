import { test, expect } from '@playwright/test';
import { mockEntityApi, BACKEND, BENCHMARK_EXPERIMENT } from './fixtures/entities';

/**
 * The Plan and Runs screens.
 *
 * The claims worth guarding are the ones the screens turn on: the axes are
 * separated from the policy, the expansion arithmetic is live and matches what
 * the plan says, and one run resolves into per-request rows a person can open.
 */

const OBSERVATION_COUNT = 3;

test.use({ viewport: { width: 1600, height: 900 } });

async function openBenchmark(page: import('@playwright/test').Page) {
  await mockEntityApi(page);
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

    for (const setting of ['statistic', 'equivalence', 'failure', 'order']) {
      await expect(page.locator(`[data-testid="benchmark-setting-${setting}"]`)).toBeVisible();
    }
  });

  test('opens the case editor on the selected case', async ({ page }) => {
    await openBenchmark(page);

    const editor = page.locator('[data-testid="benchmark-case-editor"]');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('Support');
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
    await expect(detail).toContainText('never averaged into the statistic');
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
    // The runner records no result hash, and the panel says so rather than
    // drawing an equivalence it cannot support.
    await expect(detail).toContainText('not captured');
  });
});
