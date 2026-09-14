/**
 * The unscoped tree's backend row, end to end.
 *
 * `/` is the tree, and the tree is "the only thing that reaches libraries and
 * backends" (`pages/index.vue`) — so a backend row is the way into a backend's
 * record. It used to highlight itself and emit nothing, leaving the work area
 * on whatever was already open; the pencil beside it did the navigating.
 *
 * The two assertions that matter are the pair the row has to produce: the rail
 * scoped to Backends (the record's home, which replaces the tree), and the
 * record for the backend that was *clicked*. The second one is the interesting
 * half — the section opens its first backend when nothing is selected, so a row
 * that navigated without selecting would look right for the first row and wrong
 * for every other one.
 */
import { test, expect, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';

const backends = [
  {
    id: 'urn:sqlib:backend:alpha',
    name: 'Alpha Store',
    description: 'HTTP SPARQL backend',
    backendType: 'http',
    endpoint: 'http://localhost:7878/sparql',
    authEnvKey: null,
    queryMethod: 'post',
    oxigraphConfig: null,
    dateCreated: '2026-08-01T00:00:00.000Z',
    dateModified: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'urn:sqlib:backend:beta',
    name: 'Beta Store',
    description: 'HTTP SPARQL backend',
    backendType: 'http',
    endpoint: 'http://localhost:7879/sparql',
    authEnvKey: null,
    queryMethod: 'post',
    oxigraphConfig: null,
    dateCreated: '2026-08-02T00:00:00.000Z',
    dateModified: '2026-08-02T00:00:00.000Z',
  },
];

test.describe('a backend row in the tree', () => {
  test.beforeEach(async ({ page }) => {
    await mockSidebarCollections(page);

    await page.route('**/backends', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(backends) });
    });

    await page.route('**/backends/probes', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ probes: [] }) });
    });

    await page.route('**/backends/*/env', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authEnvKey: null, variables: [] }),
      });
    });

    await page.route('**/backends/*/usage', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          queries: { count: 0, sample: [] },
          queryGroups: { count: 0, sample: [] },
          benchmarks: { count: 0, sample: [] },
          libraries: { count: 0, sample: [] },
        }),
      });
    });

    await page.route('**/backends/*', async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
      const backend = backends.find((candidate) => candidate.id === id) ?? backends[0];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(backend) });
    });

    await page.goto('/');
    await page.waitForSelector('.nav-sidebar');
  });

  test('opens the record of the backend that was clicked', async ({ page }) => {
    const row = page.locator('.backend-item').filter({ hasText: 'Beta Store' }).first();
    await expect(row).toBeVisible();

    await row.locator('.backend-button').click();

    // The record's home: scoping the rail is half of opening it.
    await expect(page.locator('[data-testid="backend-list-sidebar"]')).toBeVisible();
    // The other half, and the one a highlight-only row would get wrong.
    await expect(page.locator('[data-testid="backend-record-name"]')).toHaveText('Beta Store');
  });
});
