import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';
import { API_HOST } from './api-origin';

/**
 * What a visitor can still do when the deployment keeps nothing.
 *
 * `SQLIB_READ_ONLY=true` (the API's `config/readOnly.ts`) refuses every write
 * to the server's own state, so every query on such a deployment is a scratch
 * query — there is no saving one. Two things follow, and both were broken:
 *
 * 1. **Arguments have to work on a scratch callable.** Sets were keyed on the
 *    server id a scratch query does not have, so "New scratch set" did nothing
 *    at all — no request, no error, no set — and a parameterised query could
 *    only be run with values typed into its text.
 * 2. **The buttons that can only be refused are gone.** Save, the create-a-test
 *    chips, and the entity ⋮ are absent rather than disabled, the rule the rail
 *    already follows for a switched-off section.
 *
 * The run itself is untouched: `POST /sparql` is allowlisted read-only and
 * takes the values inline, which is what the last test here asserts.
 */

const LIBRARY = {
  id: 'urn:sqlib:library:test-1',
  name: 'Test Library',
  description: 'A test library',
  defaultBackend: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

/** Pasted into the backend picker, which registers it in the browser. */
const ENDPOINT = 'https://query.wikidata.org/sparql';

/** A query with one VALUES clause to fill. */
const QUERY_TEXT = 'SELECT ?city WHERE { VALUES (?city) { (UNDEF) } }';

const RESULTS = {
  head: { vars: ['city'] },
  results: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }] },
};

/** Bodies the app posted to `/sparql`, newest last. */
let executions: Array<Record<string, unknown>> = [];

const switcher = (page: Page) => page.locator('[data-testid="argument-set-switcher"]');
const state = (page: Page) => page.locator('[data-testid="argument-set-state"]');

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

test.describe('A read-only deployment', () => {
  test.beforeEach(async ({ page }) => {
    executions = [];

    await mockSidebarCollections(page, { libraries: [LIBRARY] });
    await page.addInitScript(() => {
      window.localStorage.setItem('sparql-query-lib-scratch-migrated', '2026-08-06T00:00:00Z');
    });

    // Registered after the fixture's, so this is the answer that stands.
    await page.route(`**//${API_HOST}/health`, async (route: Route) => {
      await json(route, { status: 'ok', auth: { mode: 'disabled' }, readOnly: true });
    });
    await page.route(`**//${API_HOST}/libraries`, (route) => json(route, [LIBRARY]));
    await page.route(`**//${API_HOST}/validate`, (route) => json(route, { valid: true }));
    await page.route(`**//${API_HOST}/detect-inputs`, (route) =>
      json(route, { valuesInputs: [['city']], limitParameters: [], offsetParameters: [] }));
    await page.route(`**//${API_HOST}/detect-outputs`, (route) => json(route, ['city']));
    await page.route(`**//${API_HOST}/argument-sets**`, (route) => json(route, []));
    await page.route(`**//${API_HOST}/sparql`, async (route: Route) => {
      executions.push(route.request().postDataJSON());
      await json(route, RESULTS);
    });
  });

  /** A scratch query with a parameterised clause, which is all there can be. */
  async function openScratchQuery(page: Page) {
    await page.goto('/?section=queries', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="entity-list-sidebar"]');
    await page.locator('[data-testid="new-scratch"]').first().click();
    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    // insertText rather than type: the editor closes brackets on keystrokes.
    await page.keyboard.insertText(QUERY_TEXT);
    await expect(editor).toContainText('VALUES');
    // Past the autosave debounce and the validate/detect round trip.
    await page.waitForTimeout(900);
  }

  async function openArgumentsTab(page: Page) {
    await page.locator('[data-testid="arguments-tab"]').click();
    await expect(switcher(page)).toBeVisible();
  }

  test('offers no Save, and nothing to keep the run as', async ({ page }) => {
    await openScratchQuery(page);

    await expect(page.locator('[data-testid="save"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="run-bar-create-test"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="run-bar-create-benchmark"]')).toHaveCount(0);
  });

  test('starts an argument set on a query that has never been saved', async ({ page }) => {
    await openScratchQuery(page);
    await openArgumentsTab(page);

    await switcher(page).click();
    await page.locator('[data-testid="argument-new-scratch"]').click();

    await expect(state(page)).toHaveText('Scratch');
    // The clause the query declares, ready to fill.
    await expect(page.locator('[data-testid="argument-clause"]')).toBeVisible();
  });

  test('keeps that set out of the way of another scratch query', async ({ page }) => {
    await openScratchQuery(page);
    await openArgumentsTab(page);
    await switcher(page).click();
    await page.locator('[data-testid="argument-new-scratch"]').click();
    await expect(state(page)).toHaveText('Scratch');

    // A second scratch query, from the same sidebar. It gets a body too: the
    // panel is behind a scrim until there is a query to detect arguments from.
    await page.locator('[data-testid="new-scratch"]').first().click();
    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(QUERY_TEXT);
    await page.waitForTimeout(900);
    await openArgumentsTab(page);

    await expect(state(page)).toHaveCount(0);
    await switcher(page).click();
    await expect(page.locator('[data-testid="argument-new-scratch"]')).toBeVisible();
    await expect(page.getByText('Untitled set 1')).toHaveCount(0);
  });

  test('offers no Save on the set either, only Discard', async ({ page }) => {
    await openScratchQuery(page);
    await openArgumentsTab(page);
    await switcher(page).click();
    await page.locator('[data-testid="argument-new-scratch"]').click();
    await page.locator('[data-testid="argument-add-row"]').first().click();
    await page.locator('[data-testid="argument-value"]').first().fill('http://example.org/Perth');

    await expect(page.locator('[data-testid="arguments-save"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="arguments-discard"]')).toBeVisible();
  });

  /*
   * The other half of running something here: a read-only deployment's
   * catalogue of backends is fixed too, so an endpoint a visitor brings has to
   * be registrable from the picker. It becomes a browser backend, which is why
   * no request goes out to make one.
   */
  test('takes a SPARQL endpoint pasted into the backend picker', async ({ page }) => {
    await openScratchQuery(page);

    await page.locator('[data-testid="run-bar-backend"]').click();
    await page.locator('[data-testid="run-bar-add-endpoint"]').click();
    await page.locator('[data-testid="run-bar-endpoint-input"]').fill(ENDPOINT);
    await page.locator('[data-testid="run-bar-endpoint-input"]').press('Enter');

    // Chosen by the act of pasting it, and the menu is done.
    await expect(page.locator('[data-testid="run-bar-backend"]')).toContainText('query.wikidata.org/sparql');
    await expect(page.locator('.backend-menu')).toHaveCount(0);
  });

  test('names a pasted endpoint from the row that shows it', async ({ page }) => {
    await openScratchQuery(page);
    await page.locator('[data-testid="run-bar-backend"]').click();
    await page.locator('[data-testid="run-bar-add-endpoint"]').click();
    await page.locator('[data-testid="run-bar-endpoint-input"]').fill(ENDPOINT);
    await page.locator('[data-testid="run-bar-endpoint-input"]').press('Enter');

    await page.locator('[data-testid="run-bar-backend"]').click();
    await page.locator('[data-testid="backend-name-endpoint"]').first().click();
    await page.locator('[data-testid="backend-name-input"]').fill('Wikidata');
    await page.locator('[data-testid="backend-name-input"]').press('Enter');

    await expect(page.locator('.backend-item').filter({ hasText: 'Wikidata' })).toBeVisible();
  });

  test('runs the draft query with the values typed into the draft set', async ({ page }) => {
    await openScratchQuery(page);
    await openArgumentsTab(page);
    await switcher(page).click();
    await page.locator('[data-testid="argument-new-scratch"]').click();
    await page.locator('[data-testid="argument-add-row"]').first().click();
    await page.locator('[data-testid="argument-value"]').first().fill('http://example.org/Perth');
    await page.waitForTimeout(600);

    await page.locator('[data-testid="run-bar-run"]').click();
    await expect.poll(() => executions.length).toBeGreaterThan(0);

    /*
     * The values travel with the query text. There is no set on the server to
     * name — that is what read-only means here — so a run that carried no
     * `arguments` would silently leave the clause unbound.
     */
    expect(executions[0]).toMatchObject({
      query: QUERY_TEXT,
      arguments: [
        {
          head: { vars: ['city'] },
          arguments: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }] },
        },
      ],
    });
  });
});
