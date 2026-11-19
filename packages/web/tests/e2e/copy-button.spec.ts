import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';
import { API_HOST } from './api-origin';

/**
 * Copy in the query editor's control row: on the page, popped out, and over
 * the raw response. Each one puts the whole document on the clipboard.
 */

const LIBRARY = {
  id: 'urn:sqlib:library:test-1',
  name: 'Test Library',
  description: 'A test library',
  defaultBackend: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const QUERY_TEXT = 'SELECT ?s WHERE { ?s ?p ?o }';
const RESPONSE = { head: { vars: ['s'] }, results: { bindings: [{ s: { type: 'uri', value: 'https://example.org/a' } }] } };

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

async function typeQuery(page: Page, text: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await expect(editor).toContainText(text.slice(0, 20));
}

test.describe('Copy button', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockSidebarCollections(page, { libraries: [LIBRARY] });
    await page.addInitScript(() => {
      window.localStorage.setItem('sparql-query-lib-scratch-migrated', '2026-08-06T00:00:00Z');
    });
    await page.goto('/?section=queries', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="entity-list-sidebar"]');
    await page.locator('[data-testid="section-overview-new"]').click();
    await typeQuery(page, QUERY_TEXT);
  });

  test('copies the query from the header row, and shows that it did', async ({ page }) => {
    const copy = page.locator('[data-testid="copy-query"]');
    await expect(copy).toHaveAttribute('title', 'Copy query');
    await copy.click();
    await expect(copy).toHaveAttribute('title', 'Copied');
    expect(await clipboard(page)).toBe(QUERY_TEXT);
  });

  test('moves into the run row when the editor pops out', async ({ page }) => {
    await page.locator('[data-testid="sparql-editor-expand"]').click();
    await expect(page.locator('[data-testid="query-editor-expand"]')).toHaveClass(/expanded/);
    const copy = page.locator('[data-testid="copy-query"]');
    await expect(copy).toHaveCount(1);
    await copy.click();
    expect(await clipboard(page)).toBe(QUERY_TEXT);
  });

  test('copies the raw response', async ({ page }) => {
    await page.route(`**//${API_HOST}/sparql`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/sparql-results+json',
        body: JSON.stringify(RESPONSE),
      });
    });
    await page.locator('[data-testid="run-bar-backend"]').click();
    await page.getByRole('option').filter({ hasText: /ephemeral/i }).first().click();
    await page.locator('[data-testid="run-bar-run"]').click();

    // The table has its own per-cell copy; the whole-response copy is Raw's.
    await expect(page.locator('[data-testid="results-copy"]')).toHaveCount(0);
    await page.getByRole('group', { name: 'Query results view' }).getByRole('button', { name: 'Raw' }).click();
    await page.locator('[data-testid="results-copy"]').click();
    expect(JSON.parse(await clipboard(page))).toEqual(RESPONSE);
  });
});
