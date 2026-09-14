/**
 * Backends as a record page — the sidebar list, the record at rest, and
 * creation as a draft record rather than a dialog.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';

const existingBackend = {
  id: 'urn:sqlib:backend:test-1',
  name: 'Existing Backend 1',
  description: 'HTTP SPARQL backend',
  backendType: 'http',
  endpoint: 'http://localhost:7878/sparql',
  authEnvKey: 'EXISTING_BACKEND_1',
  queryMethod: 'post',
  oxigraphConfig: null,
  dateCreated: '2026-08-01T00:00:00.000Z',
  dateModified: '2026-08-01T00:00:00.000Z',
};

test.describe('Backends record page (mocked)', () => {
  let lastBackendPost: any = null;
  let lastBackendPut: any = null;

  test.beforeEach(async ({ page }) => {
    lastBackendPost = null;
    lastBackendPut = null;
    const backendsStore = [{ ...existingBackend }];

    await mockSidebarCollections(page);

    await page.route('**/backends', async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(backendsStore) });
        return;
      }
      const body = route.request().postDataJSON();
      lastBackendPost = body;
      const created = {
        ...existingBackend,
        id: `urn:sqlib:backend:new-1`,
        name: body.name,
        description: body.description ?? null,
        endpoint: body.endpoint,
        authEnvKey: body.authEnvKey ?? null,
        queryMethod: body.queryMethod ?? 'post',
      };
      backendsStore.push(created);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
    });

    // The record page's reads. Probes and usage are observations the record
    // renders around; env presence is names only.
    await page.route('**/backends/probes', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ probes: [] }) });
    });

    await page.route('**/backends/*/probe', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          backendId: existingBackend.id,
          health: 'healthy',
          latencyMs: 12,
          product: 'Oxigraph 0.4.0',
          probedAt: new Date().toISOString(),
          error: null,
          httpStatus: 200,
        }),
      });
    });

    await page.route('**/backends/*/probe-history', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          probes: [
            { backendId: existingBackend.id, health: 'healthy', latencyMs: 12, product: null, probedAt: new Date().toISOString(), error: null, httpStatus: 200 },
            { backendId: existingBackend.id, health: 'unreachable', latencyMs: null, product: null, probedAt: new Date(Date.now() - 7_200_000).toISOString(), error: 'HTTP 403 Forbidden', httpStatus: 403 },
          ],
        }),
      });
    });

    await page.route('**/backends/*/env', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authEnvKey: 'EXISTING_BACKEND_1',
          variables: [
            { name: 'SQLIB_BACKEND_EXISTING_BACKEND_1_USERNAME', role: 'Basic auth username', set: true },
            { name: 'SQLIB_BACKEND_EXISTING_BACKEND_1_PASSWORD', role: 'Basic auth password', set: false },
            { name: 'SQLIB_BACKEND_EXISTING_BACKEND_1_AUTH_HEADER', role: 'Authorization header override', set: false },
          ],
        }),
      });
    });

    await page.route('**/backends/*/usage', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          queries: { count: 2, sample: [] },
          queryGroups: { count: 0, sample: [] },
          benchmarks: { count: 0, sample: [] },
          libraries: { count: 0, sample: [] },
        }),
      });
    });

    await page.route('**/backends/*', async (route: Route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(backendsStore[0]) });
        return;
      }
      if (method === 'PUT') {
        lastBackendPut = route.request().postDataJSON();
        Object.assign(backendsStore[0], lastBackendPut);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(backendsStore[0]) });
        return;
      }
      await route.fallback();
    });

    await page.goto('/?section=backends');
    await page.waitForSelector('[data-testid="backend-list-sidebar"]');
  });

  test('opens the first backend as a record, with no dialog anywhere', async ({ page }) => {
    await expect(page.locator('[data-testid="backend-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="backend-record-name"]')).toHaveText('Existing Backend 1');
    await expect(page.getByText('SQLIB_BACKEND_EXISTING_BACKEND_1_USERNAME')).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('a field is text until it is clicked, and commits on its own', async ({ page }) => {
    const field = page.locator('[data-testid="backend-field-name"]');
    await expect(field).toHaveText(/Existing Backend 1/);

    await field.click();
    const input = page.locator('[data-testid="backend-field-name-input"]');
    await input.fill('Renamed backend');
    await input.press('Enter');

    await expect.poll(() => lastBackendPut?.name).toBe('Renamed backend');
    await expect(page.locator('[data-testid="backend-field-name-input"]')).toHaveCount(0);
  });

  test('Escape reverts an edit', async ({ page }) => {
    await page.locator('[data-testid="backend-field-name"]').click();
    await page.locator('[data-testid="backend-field-name-input"]').fill('Never saved');
    await page.locator('[data-testid="backend-field-name-input"]').press('Escape');

    await expect(page.locator('[data-testid="backend-field-name"]')).toHaveText(/Existing Backend 1/);
    expect(lastBackendPut).toBeNull();
  });

  test('an endpoint without a scheme is refused in place', async ({ page }) => {
    await page.locator('[data-testid="backend-field-endpoint"]').click();
    const input = page.locator('[data-testid="backend-field-endpoint-input"]');
    await input.fill('localhost:7878/sparql');
    await input.press('Enter');

    await expect(page.locator('[data-testid="backend-field-endpoint-error"]')).toContainText('scheme');
    expect(lastBackendPut).toBeNull();
  });

  test('Test again fills in the health card, the pill and the product', async ({ page }) => {
    await expect(page.locator('[data-testid="backend-health-pill"]')).toContainText('Never probed');

    await page.locator('[data-testid="test-connection"]').click();

    await expect(page.locator('[data-testid="backend-health-pill"]')).toContainText('Healthy');
    await expect(page.locator('[data-testid="backend-health-message"]')).toHaveText('Answered in 12 ms.');
    await expect(page.locator('[data-testid="backend-product"]')).toHaveText('Oxigraph 0.4.0');
    await expect(page.locator('[data-testid="backend-health-dot"]').first()).toHaveClass(/health-dot--healthy/);
  });

  test('the observed half sits in a sidecar: health, libraries, usage', async ({ page }) => {
    const sidecar = page.locator('[data-testid="backend-sidecar"]');

    await expect(sidecar.locator('[data-testid="backend-health-card"]')).toBeVisible();
    await expect(sidecar.getByText('None attached.')).toBeVisible();
    // Three rows, no libraries row — the card above it already answers that.
    await expect(sidecar.locator('[data-testid="usage-row"]')).toHaveCount(3);
    await expect(sidecar.locator('[data-testid="usage-row"]').first()).toContainText('Queries');
    await expect(sidecar.locator('[data-testid="usage-row"]').nth(1)).toBeDisabled();
  });

  test('Probe history opens the last few observations', async ({ page }) => {
    await expect(page.locator('[data-testid="probe-history-list"]')).toHaveCount(0);

    await page.locator('[data-testid="probe-history"]').click();

    await expect(page.locator('[data-testid="probe-history-list"]')).toContainText('HTTP 403 Forbidden');
    await expect(page.locator('.history-row')).toHaveCount(2);
  });

  test('a Used by row opens the list that holds them', async ({ page }) => {
    await page.locator('[data-testid="usage-row"]').first().click();

    await expect(page).toHaveURL(/section=queries/);
  });

  test('creation is a draft record: + adds an unsaved row and the pane fills it in', async ({ page }) => {
    await page.locator('[data-testid="new-backend"]').click();

    await expect(page.locator('[data-testid="backend-draft-row"]')).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    const create = page.locator('[data-testid="create-backend"]');
    await expect(create).toBeDisabled();

    await page.locator('[data-testid="backend-draft-name"]').fill('My HTTP Backend');
    // The environment key writes itself from the name.
    await expect(page.locator('[data-testid="backend-draft-env-key"]')).toHaveValue('MY_HTTP_BACKEND');

    await page.locator('[data-testid="backend-draft-endpoint"]').fill('http://example.com/sparql');
    await expect(create).toBeEnabled();
    await create.click();

    await expect.poll(() => lastBackendPost?.name).toBe('My HTTP Backend');
    expect(lastBackendPost.backendType).toBe('http');
    expect(lastBackendPost.endpoint).toBe('http://example.com/sparql');
    expect(lastBackendPost.authEnvKey).toBe('MY_HTTP_BACKEND');
    await expect(page.locator('[data-testid="backend-draft-row"]')).toHaveCount(0);
  });

  test('discarding the draft leaves nothing behind', async ({ page }: { page: Page }) => {
    await page.locator('[data-testid="new-backend"]').click();
    await page.locator('[data-testid="backend-draft-name"]').fill('Not going to keep this');

    await page.locator('[data-testid="discard-backend"]').click();

    await expect(page.locator('[data-testid="backend-draft-row"]')).toHaveCount(0);
    expect(lastBackendPost).toBeNull();
  });
});
