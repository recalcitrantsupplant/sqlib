import { test, expect, type Page } from '@playwright/test';
import { mockCallableLibrary, LIBRARY } from './fixtures/callables';

/**
 * The notebook screen — a document you write, run in order.
 *
 * Driven in a real browser rather than only in happy-dom because the parts that
 * make a cell runnable only exist there: `<sqlib-args>` is a custom element
 * registered at runtime, and the whole point of the screen is a sequence of
 * real requests whose results feed each other.
 *
 * The library fixture is the callables one, deliberately: the notebook reads the
 * API — queries, groups and rule sets — rather than the export bundle, which is
 * what lets a rule-set cell exist at all.
 */

async function openNotebook(page: Page) {
  await page.goto(`/notebook?library=${encodeURIComponent(LIBRARY.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId('notebook-title')).toBeVisible();
}

async function insertFirstQuery(page: Page) {
  await page.getByTestId('notebook-add-cell').click();
  await page.getByTestId('notebook-insert-urn:sqlib:query:product-search').click();
}


test.describe('Notebook', () => {
  test.beforeEach(async ({ page }) => {
    await mockCallableLibrary(page);
  });

  test('opens empty, with nothing run and nothing bound', async ({ page }) => {
    await openNotebook(page);
    await expect(page.getByText('An empty notebook')).toBeVisible();
    await expect(page.getByTestId('notebook-rail')).toContainText('No cells yet');

    // What it has produced is the inspector's other tab, beside what it says.
    await page.getByTestId('values-tab').click();
    await expect(page.getByTestId('notebook-values')).toContainText('Nothing has run');
  });

  test('offers queries, groups and rule sets, which the bundle could not carry', async ({ page }) => {
    await openNotebook(page);
    await page.getByTestId('notebook-add-cell').click();

    await expect(page.getByTestId('notebook-insert-tab-query')).toContainText('4');
    await expect(page.getByTestId('notebook-insert-tab-group')).toContainText('1');
    await expect(page.getByTestId('notebook-insert-tab-ruleset')).toContainText('1');

    await page.getByTestId('notebook-insert-tab-ruleset').click();
    await expect(page.getByTestId('notebook-insert-list')).toContainText('Pricing');
  });

  test('binds a run result to a name, with its stats beside it', async ({ page }) => {
    await openNotebook(page);
    await insertFirstQuery(page);

    const cell = page.locator('[data-testid^="notebook-cell-"]').first();
    await expect(cell).toContainText('Product search');

    await cell.getByTestId('run-bar-run').click();

    await expect(cell.locator('[data-testid^="notebook-stats-"]')).toContainText('1 row · 3 cols');
    await page.getByTestId('values-tab').click();
    await expect(page.getByTestId('notebook-value-out1')).toContainText('1 row · 3 cols');
  });

  test('a renamed value keeps what it holds', async ({ page }) => {
    await openNotebook(page);
    await insertFirstQuery(page);

    const cell = page.locator('[data-testid^="notebook-cell-"]').first();
    await cell.getByTestId('run-bar-run').click();
    await expect(cell.locator('[data-testid^="notebook-stats-"]')).toBeVisible();

    await cell.locator('[data-testid^="notebook-out-"]').fill('candidates');
    await cell.locator('[data-testid^="notebook-out-"]').press('Enter');

    await page.getByTestId('values-tab').click();
    await expect(page.getByTestId('notebook-value-candidates')).toContainText('1 row · 3 cols');
  });

  test('feeds one cell rows into the next, and marks it stale when the source re-runs', async ({ page }) => {
    await openNotebook(page);
    await insertFirstQuery(page);

    const first = page.locator('[data-testid^="notebook-cell-"]').first();
    await first.getByTestId('run-bar-run').click();
    await expect(first.locator('[data-testid^="notebook-stats-"]')).toBeVisible();

    await page.getByTestId('notebook-add-cell').click();
    await page.getByTestId('notebook-insert-urn:sqlib:query:product-graph').click();

    const second = page.locator('[data-testid^="notebook-cell-"]').nth(1);
    const source = second.locator('[data-testid^="notebook-slot-source-"]').first();
    await source.selectOption('@out1');
    await expect(second).toContainText('by value');

    await second.getByTestId('run-bar-run').click();
    await expect(second.locator('[data-testid^="notebook-status-"]')).toContainText('ran');

    // Re-running the source marks the cell below rather than re-running it.
    await first.getByTestId('run-bar-run').click();
    await expect(second.locator('[data-testid^="notebook-stale-"]')).toHaveText('stale');
    await expect(second.getByTestId('run-bar-run')).toContainText('Re-run');
  });

  test('writes prose between the runs', async ({ page }) => {
    await openNotebook(page);
    await page.getByTestId('notebook-add-markdown').click();

    const editor = page.locator('[data-testid^="notebook-md-editor-"] .cm-content').first();
    await editor.click();
    await editor.pressSequentially('## Candidates');
    await page.getByText('Done', { exact: true }).first().click();

    await expect(page.locator('[data-testid^="notebook-md-rendered-"]').first().locator('h2')).toHaveText(
      'Candidates',
    );
    await expect(page.getByTestId('notebook-rail')).toContainText('Candidates');
  });

  test('wires a chain before anything has run, then drives it with Run all', async ({ page }) => {
    await openNotebook(page);
    await insertFirstQuery(page);
    await page.getByTestId('notebook-add-cell').click();
    await page.getByTestId('notebook-insert-urn:sqlib:query:product-graph').click();

    const second = page.locator('[data-testid^="notebook-cell-"]').nth(1);
    const source = second.locator('[data-testid^="notebook-slot-source-"]').first();
    // Nothing has run, so the name is offered with what it will hold rather
    // than with a count.
    await source.selectOption('@out1');
    await expect(second).toContainText('not run yet');

    await page.getByTestId('notebook-run-all').click();

    await expect(second.locator('[data-testid^="notebook-status-"]')).toContainText('ran');
    await page.getByTestId('values-tab').click();
    await expect(page.getByTestId('notebook-value-out2')).toBeVisible();
  });

  test('shows the query a cell will run, rather than only its name', async ({ page }) => {
    await openNotebook(page);
    await insertFirstQuery(page);

    const cell = page.locator('[data-testid^="notebook-cell-"]').first();
    await expect(cell.locator('[data-testid^="notebook-query-"]').first()).toContainText('SELECT');
  });

  test('lists notebooks in the sidebar, like every other asset', async ({ page }) => {
    await openNotebook(page);
    await expect(page.getByTestId('entity-list-sidebar')).toContainText('Notebooks');

    // Writing into an empty screen mints the document the list then holds.
    await page.getByTestId('notebook-add-markdown').click();
    await expect(page.getByTestId('entity-list-sidebar')).toContainText('Untitled notebook');
  });

  test('keeps a notebook across a reload, and opens it again', async ({ page }) => {
    await openNotebook(page);
    await page.getByTestId('notebook-add-markdown').click();

    const editor = page.locator('[data-testid^="notebook-md-editor-"] .cm-content').first();
    await editor.click();
    await editor.pressSequentially('## Kept');
    await expect(page.getByTestId('notebook-saved-note')).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-testid^="notebook-md-rendered-"]').first()).toContainText('Kept');
  });

  test('starts a second notebook without disturbing the first', async ({ page }) => {
    await openNotebook(page);
    await page.getByTestId('notebook-add-markdown').click();
    await expect(page.getByTestId('entity-list-sidebar')).toContainText('Untitled notebook');

    await page.getByTestId('new-scratch').click();

    await expect(page.locator('[data-testid^="notebook-md-rendered-"]')).toHaveCount(0);
    await expect(page.getByTestId('entity-list-sidebar').getByText('Untitled notebook')).toHaveCount(2);
  });

  /*
   * The link out used a generic `item` parameter the editor screen does not
   * read, so it landed on the right screen with nothing selected — inherited
   * from the page this one replaced, where it was just as broken.
   */
  test('opens the query it names in the editor, not just the queries screen', async ({ page }) => {
    await openNotebook(page);
    await insertFirstQuery(page);

    await page.locator('[data-testid^="notebook-cell-"]').first().getByText('Open in editor').click();

    await expect(page).toHaveURL(/query=urn%3Asqlib%3Aquery%3Aproduct-search|query=urn:sqlib:query:product-search/);
    await expect(page.locator('.query-work-area')).toBeVisible();
  });

  test('runs against a store you can choose, and asks for a format', async ({ page }) => {
    await openNotebook(page);
    await insertFirstQuery(page);

    const cell = page.locator('[data-testid^="notebook-cell-"]').first();
    // The run sentence, minus the "with" clause a notebook answers itself.
    await expect(cell.getByTestId('run-bar-backend')).toBeVisible();
    await expect(cell.getByTestId('run-bar-format')).toBeVisible();
    await expect(cell.getByTestId('run-bar')).not.toContainText('arguments');
  });

  test('gives the inspector a drag handle, as every other work area has', async ({ page }) => {
    await openNotebook(page);
    await expect(page.locator('.vertical-resizer')).toBeVisible();
  });

  test('renders a markdown heading scale you can see a step in', async ({ page }) => {
    await openNotebook(page);
    await page.getByTestId('notebook-add-markdown').click();

    const editor = page.locator('[data-testid^="notebook-md-editor-"] .cm-content').first();
    await editor.click();
    await editor.pressSequentially('# One\n## Two\n### Three\n\nA [link](http://example.com).');
    await page.getByText('Done', { exact: true }).first().click();

    const prose = page.locator('[data-testid^="notebook-md-rendered-"]').first();
    const size = (selector: string) =>
      prose.locator(selector).evaluate((element) => parseFloat(getComputedStyle(element).fontSize));

    expect(await size('h1')).toBeGreaterThan(await size('h2'));
    expect(await size('h2')).toBeGreaterThan(await size('h3'));

    // And a link that reads as one rather than inheriting the prose colour.
    const linkColour = await prose.locator('a').evaluate((element) => getComputedStyle(element).color);
    const proseColour = await prose.evaluate((element) => getComputedStyle(element).color);
    expect(linkColour).not.toBe(proseColour);
  });

  test('starts from the library when someone wants every query as a draft', async ({ page }) => {
    await openNotebook(page);
    await page.getByTestId('notebook-start-from-library').click();

    await expect(page.locator('[data-testid^="notebook-cell-"]')).toHaveCount(4);
  });
});
