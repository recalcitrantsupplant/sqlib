import { test, expect, type Page } from '@playwright/test';
import { mockCallableLibrary, seedDraft, LIBRARY } from './fixtures/callables';

/**
 * The Build screen's artifact pane.
 *
 * The thing worth testing here is not that boxes render — it is that the
 * screen tells the truth about what an app can call: that a draft is visibly
 * not live, that a signature shows the arguments a caller actually supplies,
 * and that saving turns one into the other.
 */

async function openBuild(page: Page) {
  await page.goto('/build', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.callable-table');
  /*
   * The table's chrome renders before its rows do — a callable's signature
   * lives on its version, so the list arrives a request later. Waiting on the
   * table alone is a race that a fast machine wins and a loaded one loses.
   */
  await expect(page.locator('.callable-row').first()).toBeVisible();
}

function row(page: Page, name: string) {
  return page.locator('.callable-row').filter({ hasText: name });
}

test.describe('Build screen', () => {
  test.beforeEach(async ({ page }) => {
    await mockCallableLibrary(page);
  });

  test('lists queries and groups as one flat kind of callable', async ({ page }) => {
    await openBuild(page);

    await expect(page.locator('.callable-row')).toHaveCount(5);
    const names = await page.locator('.callable-row .name').allTextContents();
    expect(names.sort()).toEqual([
      'Catalogue facets',
      'Is in stock',
      'Order detail',
      'Product graph',
      'Product search',
    ]);
  });

  test('shows the version each callable is on', async ({ page }) => {
    await openBuild(page);
    await expect(row(page, 'Is in stock').locator('[data-testid="callable-version-pill"]')).toHaveText('v4');
    await expect(row(page, 'Catalogue facets').locator('[data-testid="callable-version-pill"]')).toHaveText('v6');
  });

  test('labels the result kind on the returns rail, not as a badge', async ({ page }) => {
    await openBuild(page);

    await expect(row(page, 'Product search').locator('.signature-returns .rail')).toHaveText(
      'BINDINGS'
    );
    await expect(row(page, 'Is in stock').locator('.signature-returns .rail')).toHaveText('BOOLEAN');
    await expect(row(page, 'Product graph').locator('.signature-returns .rail')).toHaveText('GRAPH');
  });

  test('summarises inputs from tuples and parameters', async ({ page }) => {
    await openBuild(page);

    await expect(row(page, 'Product search').locator('.signature-inputs .summary')).toHaveText(
      'term, limit'
    );
    // One tuple, two members — both are supplied together.
    await expect(row(page, 'Is in stock').locator('.signature-inputs .summary')).toHaveText(
      'product, qty'
    );
    await expect(row(page, 'Catalogue facets').locator('.signature-inputs .summary')).toHaveText(
      'none'
    );
  });

  test('renders a boolean and a graph result as the shape a caller gets back', async ({ page }) => {
    await openBuild(page);
    await expect(row(page, 'Is in stock').locator('.signature-returns .summary')).toHaveText(
      'true / false'
    );
    await expect(row(page, 'Product graph').locator('.signature-returns .summary')).toHaveText(
      '?s ?p ?o'
    );
  });

  test('a group says what it composes', async ({ page }) => {
    await openBuild(page);
    await expect(row(page, 'Order detail').locator('.description')).toContainText('composes 2');
  });

  test('expanding all signatures shows datatypes and defaults', async ({ page }) => {
    await openBuild(page);
    await page.getByRole('button', { name: 'Expand all signatures' }).click();

    const inputs = row(page, 'Is in stock').locator('.signature-inputs');
    await expect(inputs.locator('.entry')).toHaveCount(2);
    await expect(inputs.locator('.entry-type').first()).toHaveText('xsd:anyURI');
    // Both members of one tuple, which is what says they go in together.
    await expect(inputs.locator('.entry-qualifier').first()).toHaveText('tuple 1');

    const search = row(page, 'Product search').locator('.signature-inputs');
    await expect(search.locator('.entry-qualifier')).toHaveText('default 20');
  });

  test('type chips both count and filter', async ({ page }) => {
    await openBuild(page);

    await expect(page.locator('.chip').filter({ hasText: 'Queries' })).toContainText('4');
    await expect(page.locator('.chip').filter({ hasText: 'Groups' })).toContainText('1');

    await page.locator('.chip').filter({ hasText: 'Groups' }).click();
    await expect(page.locator('.callable-row')).toHaveCount(1);
    await expect(page.locator('.callable-row .name')).toHaveText('Order detail');
  });

  test('search narrows the list', async ({ page }) => {
    await openBuild(page);
    await page.getByLabel('Search callables').fill('stock');
    await expect(page.locator('.callable-row')).toHaveCount(1);
    await expect(page.locator('.callable-row .name')).toHaveText('Is in stock');
  });

  test('rule sets are listed apart from callables and marked not callable', async ({ page }) => {
    await openBuild(page);

    const section = page.locator('.config-section').filter({ hasText: 'Rulesets' });
    // The note is an <InlineNote> and carries no class of its own, so the
    // assertion reads a testid rather than a style hook that is not a style.
    await expect(section.getByTestId('config-section-note')).toContainText('not callable');
    await expect(section.locator('.config-row .row-name')).toHaveText('Pricing');
    // And it is nowhere in the callable table.
    await expect(page.locator('.callable-row').filter({ hasText: 'Pricing' })).toHaveCount(0);
  });

  test('backends show with the library default marked', async ({ page }) => {
    await openBuild(page);

    const section = page.locator('.config-section').filter({ hasText: 'Backends' });
    await expect(section.locator('.config-row .row-name')).toHaveText('Storefront GDB');
    await expect(section.locator('[data-testid="config-row-badge"]')).toHaveText('library default');
  });

  // Switching happens once, at the head of the nav rail — Build reads the
  // active library rather than offering a second control for the same thing.
  test('switching library scope empties the pane and puts it in the URL', async ({ page }) => {
    await openBuild(page);
    await page.locator('.nav-rail [data-testid="library-switcher"]').click();
    await page.getByRole('menuitem').filter({ hasText: 'Warehouse' }).click();

    await expect(page).toHaveURL(/library=urn:sqlib:library:warehouse/);
    await expect(page.locator('.callable-row')).toHaveCount(0);
    await expect(page.locator('.callable-table .empty-state__title')).toContainText('Nothing callable');
  });
});

test.describe('Build screen — expanded row', () => {
  test.beforeEach(async ({ page }) => {
    await mockCallableLibrary(page);
    await openBuild(page);
  });

  test('opens one row at a time', async ({ page }) => {
    await row(page, 'Product search').locator('.expander').click();
    await expect(page.locator('.detail')).toHaveCount(1);

    await row(page, 'Is in stock').locator('.expander').click();
    await expect(page.locator('.detail')).toHaveCount(1);
    // The one that is open is the one just clicked, not the first one: these
    // are Is in stock's arguments, and Product search has neither.
    await expect(page.locator('.detail .field-input[data-arg$=":qty"]')).toBeVisible();
  });

  test('the row action opens straight onto its tab', async ({ page }) => {
    await row(page, 'Product search').getByTitle('Code').click();
    await expect(page.locator('.detail .tab.active')).toHaveText('Code');
    await expect(page.locator('.snippet')).toContainText('curl -X POST');
  });

  test('Try it builds a form from the detected inputs and runs it', async ({ page }) => {
    await row(page, 'Product search').getByTitle('Try it').click();

    await page.locator('.field-input[data-arg$=":term"]').fill('jumper');
    await page.getByRole('button', { name: 'Run' }).click();

    await expect(page.locator('.status.ok')).toContainText('1 row');
    await expect(page.locator('.results-head')).toContainText('?product');
    await expect(page.locator('.results-row').first()).toContainText('Wool jumper');
  });

  test('a two-member tuple is one repeatable row, not two fields', async ({ page }) => {
    await row(page, 'Is in stock').getByTitle('Try it').click();

    await expect(page.locator('.tuple-row')).toHaveCount(1);
    await expect(page.locator('.tuple-row .field')).toHaveCount(2);

    await page.getByRole('button', { name: 'Add row' }).click();
    await expect(page.locator('.tuple-row')).toHaveCount(2);
  });

  test('a callable with no arguments says so rather than showing an empty form', async ({
    page,
  }) => {
    await row(page, 'Catalogue facets').getByTitle('Try it').click();
    await expect(page.locator('.no-args')).toContainText('takes none');
  });

  test('Code offers the five languages and copies the snippet', async ({ page }) => {
    await row(page, 'Product search').getByTitle('Code').click();

    const labels = await page.locator('.language-tab').allTextContents();
    expect(labels).toEqual(['cURL', 'JavaScript', 'Python', 'Java', 'Go']);

    await page.locator('.language-tab').filter({ hasText: 'Python' }).click();
    await expect(page.locator('.snippet')).toContainText('import os, requests');
  });

  test('Composition finds a callable whose inputs this output covers', async ({ page }) => {
    await row(page, 'Product search').locator('.expander').click();
    await page.locator('.detail .tab').filter({ hasText: 'Composition' }).click();

    // Product search returns ?product; Product graph takes product.
    await expect(page.locator('.composition .match')).toHaveCount(1);
    await expect(page.locator('.composition .match-name')).toHaveText('Product graph');
    await expect(page.locator('.composition .match-variables')).toHaveText('?product');
  });

  test('Composition says so when nothing can chain', async ({ page }) => {
    await row(page, 'Order detail').locator('.expander').click();
    await page.locator('.detail .tab').filter({ hasText: 'Composition' }).click();

    await expect(page.locator('.composition')).toContainText('No other callable takes these');
  });

  test('Composition says why a graph result has nothing to chain', async ({ page }) => {
    await row(page, 'Product graph').locator('.expander').click();
    await page.locator('.detail .tab').filter({ hasText: 'Composition' }).click();

    await expect(page.locator('.composition')).toContainText('nothing to match on');
  });
});

test.describe('Build screen — drafts', () => {
  test.beforeEach(async ({ page }) => {
    await mockCallableLibrary(page);
    await seedDraft(page);
  });

  test('a draft is visibly not live', async ({ page }) => {
    await openBuild(page);

    const draftRow = row(page, 'Product detail');
    await expect(draftRow).toHaveClass(/draft/);
    await expect(draftRow.locator('[data-testid="callable-version-pill"]')).toHaveText('Draft');
  });

  test('drafts sort above saved callables', async ({ page }) => {
    await openBuild(page);
    await expect(page.locator('.callable-row .name').first()).toHaveText('Product detail');
  });

  test('the header counts live and draft separately', async ({ page }) => {
    await openBuild(page);
    await expect(page.locator('[data-testid="live-count-pill"]')).toHaveText('5 live');
    await expect(page.locator('[data-testid="draft-count-pill"]')).toContainText('1 draft');
  });

  test('the state filter isolates drafts', async ({ page }) => {
    await openBuild(page);
    await page.locator('.segment').filter({ hasText: 'Drafts' }).click();
    await expect(page.locator('.callable-row')).toHaveCount(1);
    await expect(page.locator('.callable-row .name')).toHaveText('Product detail');
  });

  test('the Code tab warns that a draft endpoint is not live yet', async ({ page }) => {
    await openBuild(page);
    await row(page, 'Product detail').getByTitle('Code').click();
    await expect(page.getByTestId('callable-draft-warning')).toContainText('save to call this');
  });

  test('saving posts a new version and the row stops being a draft', async ({ page }) => {
    const writes = await mockCallableLibrary(page);
    await seedDraft(page);
    await openBuild(page);

    await expect(page.locator('[data-testid="draft-count-pill"]')).toContainText('1 draft');
    await page.getByRole('button', { name: 'Save 1 draft' }).click();

    // Save is create-a-version: versioned entities are immutable.
    await expect
      .poll(() => writes.filter((write) => write.method === 'POST' && /\/v$/.test(write.pathname)))
      .toHaveLength(1);
    await expect(page.locator('.callable-row').filter({ hasText: 'Product detail' })).toHaveCount(0);
    await expect(page.locator('[data-testid="draft-count-pill"]')).toHaveCount(0);
  });

  test('Save is disabled when there is nothing to save', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('sparql-query-lib-callable-drafts'));
    await openBuild(page);
    await expect(page.getByRole('button', { name: 'Nothing to save' })).toBeDisabled();
  });
});

test.describe('Build screen — assistant rail', () => {
  test.beforeEach(async ({ page }) => {
    await mockCallableLibrary(page);
    await openBuild(page);
  });

  test('says plainly that it is not usable yet rather than looking live', async ({ page }) => {
    // The rail is wired to the assistant endpoint now, so what is missing is a
    // model provider rather than a server. Coverage of the wired path is in
    // assistant-rail.spec.ts.
    await expect(page.locator('[data-testid="assistant-status"]')).not.toHaveClass(/status-badge--success/);
    await expect(page.locator('.not-connected')).toContainText('Choose a model provider');
    await expect(page.getByLabel('Message the assistant')).toBeDisabled();
  });

  test('the empty state tells you what the screen is for', async ({ page }) => {
    await expect(page.locator('.chat-empty-title')).toContainText('Describe what your app needs');
  });

  test('the library name rides on the composer chip', async ({ page }) => {
    await expect(page.locator('.backend-chip')).toContainText(LIBRARY.name);
  });
});
