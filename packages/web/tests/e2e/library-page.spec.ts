import { test, expect, type Page } from '@playwright/test';
import { mockCallableLibrary, EXPORT_BUNDLE, LIBRARY } from './fixtures/callables';

/**
 * The library page — a library as a runnable notebook.
 *
 * Worth driving in a real browser rather than only in jsdom, because the parts
 * this page is actually made of only exist there: `<sqlib-args>` is a custom
 * element registered at runtime, the substituted pane is produced by the
 * runtime bundle running client-side, and both query panes are CodeMirror.
 *
 * The first version of this file asserted only on DOM text, which is how a page
 * whose argument builder had no stylesheet at all passed every check. So the
 * styling assertions below are deliberate: they check that the shared element
 * is *dressed*, not merely present.
 */

async function openLibrary(page: Page) {
  await page.goto(`/library?library=${encodeURIComponent(LIBRARY.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-testid^="notebook-cell-"]').first()).toBeVisible();
}

const cell = (page: Page, slug: string) => page.locator(`[data-testid="notebook-cell-${slug}"]`);

test.describe('Library page', () => {
  test.beforeEach(async ({ page }) => {
    await mockCallableLibrary(page);
  });

  test('opens the library as a document, with the librarian\'s own words', async ({ page }) => {
    await openLibrary(page);
    await expect(page.locator('.page-title')).toHaveText(LIBRARY.name);
    await expect(page.locator('.page-standfirst')).toHaveText(LIBRARY.description);
    await expect(page.locator('.page-meta')).toContainText('3 queries');
  });

  test('lists every query in a contents rail beside the document', async ({ page }) => {
    await openLibrary(page);
    const contents = page.locator('[data-testid="notebook-contents"]');
    await expect(contents).toBeVisible();
    await expect(contents.locator('[data-testid^="notebook-toc-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="notebook-cell-"]')).toHaveCount(3);
  });

  test('groups the contents by what the entries are, not by what they return', async ({ page }) => {
    await openLibrary(page);
    const contents = page.locator('[data-testid="notebook-contents"]');
    // Tag is the default grouping; this is about the Kind view.
    await contents.getByRole('button', { name: 'Kind' }).click();
    // "Queries", the app's own word for the artefact — SELECT/ASK/CONSTRUCT is
    // the result form, and it rides on each entry as a badge instead.
    await expect(contents).toContainText('Queries');
    await expect(contents).not.toContainText('SELECTS');
    await expect(contents).not.toContainText('ASKS');
  });

  test('badges each entry with the result form it returns', async ({ page }) => {
    await openLibrary(page);
    const contents = page.locator('[data-testid="notebook-contents"]');
    await expect(contents.locator('[data-testid="notebook-toc-product-search"]')).toContainText('SELECT');
    await expect(contents.locator('[data-testid="notebook-toc-is-in-stock"]')).toContainText('ASK');
    await expect(contents.locator('[data-testid="notebook-toc-product-graph"]')).toContainText('CONSTRUCT');
  });

  test('sets names in the UI face, reserving the mono face for machine text', async ({ page }) => {
    await openLibrary(page);
    const faceOf = (locator: ReturnType<typeof page.locator>) =>
      locator.evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
    // A query is named, not quoted: its name is prose, and only the signature
    // beneath it — variable names — is machine text.
    expect(await faceOf(page.locator('.cell__name').first())).not.toContain('mono');
    expect(await faceOf(page.locator('.entry__name').first())).not.toContain('mono');
    expect(await faceOf(page.locator('.signature').first())).toContain('mono');
  });

  test('regroups the contents by tag on request', async ({ page }) => {
    await openLibrary(page);
    const contents = page.locator('[data-testid="notebook-contents"]');
    await contents.getByRole('button', { name: 'Tag' }).click();
    await expect(contents).toContainText('catalogue');
    await expect(contents).toContainText('stock');
    // A query carrying no tag still has to appear somewhere.
    await expect(contents).toContainText('Untagged');
  });

  /* ---------------------------------------------------------------- *
   * Every query type the bundle can carry.
   * ---------------------------------------------------------------- */

  test('renders a cell for SELECT, ASK and CONSTRUCT alike', async ({ page }) => {
    await openLibrary(page);
    await expect(cell(page, 'product-search')).toContainText('SELECT');
    await expect(cell(page, 'is-in-stock')).toContainText('ASK');
    await expect(cell(page, 'product-graph')).toContainText('CONSTRUCT');
  });

  test('opens on the template, in the author\'s all-UNDEF spelling', async ({ page }) => {
    await openLibrary(page);
    const target = cell(page, 'product-search');
    await expect(target.locator('[data-testid="notebook-template"]')).toContainText(
      'VALUES ?term { UNDEF }',
    );
    // One pane: the substituted query is a click away, not a second column.
    await expect(target.locator('[data-testid="notebook-substituted"]')).toHaveCount(0);
  });

  test('substitutes in the browser: the example\'s value lands in the query', async ({ page }) => {
    await openLibrary(page);
    const target = cell(page, 'product-search');
    await target.locator('[data-testid="notebook-view-substituted"]').click();
    await expect(target.locator('[data-testid="notebook-substituted"]')).toContainText(
      'VALUES ?term { "jumper" }',
    );
  });

  test('syntax-highlights both views rather than dumping monospace text', async ({ page }) => {
    await openLibrary(page);
    const target = cell(page, 'product-search');
    // CodeMirror emits token spans; a plain <pre> would have none.
    await expect(
      target.locator('[data-testid="notebook-template"] .cm-content span').first(),
    ).toBeVisible();
    await target.locator('[data-testid="notebook-view-substituted"]').click();
    await expect(
      target.locator('[data-testid="notebook-substituted"] .cm-content span').first(),
    ).toBeVisible();
  });

  test('carries a query with no examples on a runnable skeleton', async ({ page }) => {
    await openLibrary(page);
    const stock = cell(page, 'is-in-stock');
    // No chips row, and Run is offered: the wildcard row is dropped by the
    // runtime, so the query opens valid rather than red.
    await expect(stock.locator('[data-testid^="notebook-example-"]')).toHaveCount(0);
    await expect(stock.locator('[data-testid="notebook-run"]')).toBeEnabled();
  });

  test('offers a limit parameter as its own field', async ({ page }) => {
    await openLibrary(page);
    await expect(cell(page, 'product-search').locator('.sqlib-args__limit')).toHaveCount(1);
  });

  /* ---------------------------------------------------------------- *
   * The shared argument builder, dressed in the app's design system.
   * ---------------------------------------------------------------- */

  test('upgrades the shared argument builder rather than rendering an inert tag', async ({ page }) => {
    await openLibrary(page);
    await expect(cell(page, 'product-search').locator('sqlib-args table')).toBeVisible();
  });

  test('dresses the builder in the app\'s tokens, not the browser defaults', async ({ page }) => {
    await openLibrary(page);
    const input = cell(page, 'product-search').locator('.sqlib-args__cell input').first();
    await expect(input).toBeVisible();
    // An unstyled input has no border-radius and the UA's own font. Either one
    // alone could be coincidence; together they say a stylesheet applied.
    const style = await input.evaluate((el) => {
      const s = getComputedStyle(el);
      return { radius: s.borderRadius, family: s.fontFamily };
    });
    expect(style.radius).not.toBe('0px');
    expect(style.family.toLowerCase()).toContain('mono');
  });

  test('lays the Form/JSON toggle out as a segmented control', async ({ page }) => {
    await openLibrary(page);
    const modes = cell(page, 'product-search').locator('.sqlib-args__modes');
    await expect(modes).toBeVisible();
    // Unstyled, the two buttons are inline and the row collapses to text
    // height; the segmented control is a bordered strip.
    const box = await modes.boundingBox();
    expect(box!.height).toBeGreaterThan(20);
  });

  test('edits an argument by hand and re-substitutes as you type', async ({ page }) => {
    await openLibrary(page);
    const target = cell(page, 'product-search');
    await target.locator('[data-testid="notebook-view-substituted"]').click();
    await target.locator('.sqlib-args__cell input').first().fill('scarf');
    await expect(target.locator('[data-testid="notebook-substituted"]')).toContainText(
      'VALUES ?term { "scarf" }',
    );
  });

  test('refuses to run an argument that cannot be substituted, and says why', async ({ page }) => {
    await openLibrary(page);
    const target = cell(page, 'product-search');
    await target.locator('.sqlib-args__cell select').first().selectOption('uri');
    await target.locator('.sqlib-args__cell input').first().fill('not an iri');
    await expect(target.locator('[data-testid="notebook-run"]')).toBeDisabled();
  });

  /* ---------------------------------------------------------------- *
   * Running, and what comes back.
   * ---------------------------------------------------------------- */

  test('runs through the API and tabulates what comes back', async ({ page }) => {
    await openLibrary(page);
    const target = cell(page, 'product-search');
    await target.locator('[data-testid="notebook-run"]').click();
    await expect(target.locator('.runbar__status')).toContainText('ran in');
    await expect(target.locator('[data-testid="notebook-result"] tbody tr')).not.toHaveCount(0);
  });

  test('offers save-as-test only after a run has produced something to record', async ({ page }) => {
    await openLibrary(page);
    const target = cell(page, 'product-search');
    await expect(target.locator('[data-testid="notebook-save-as-test"]')).toHaveCount(0);
    await target.locator('[data-testid="notebook-run"]').click();
    await expect(target.locator('[data-testid="notebook-save-as-test"]')).toBeVisible();
  });

  test('resets to the example after the arguments are edited', async ({ page }) => {
    await openLibrary(page);
    const target = cell(page, 'product-search');
    await target.locator('[data-testid="notebook-view-substituted"]').click();
    await target.locator('.sqlib-args__cell input').first().fill('scarf');
    await target.locator('[data-testid="notebook-reset"]').click();
    await expect(target.locator('[data-testid="notebook-substituted"]')).toContainText(
      'VALUES ?term { "jumper" }',
    );
  });

  test('presents a recorded result as reference, and never diffs it', async ({ page }) => {
    await openLibrary(page);
    const target = cell(page, 'product-search');
    await expect(target).toContainText('reference only, not assertions');
  });

  test('badges a data-dependent example as seeded', async ({ page }) => {
    await openLibrary(page);
    await expect(
      cell(page, 'product-search').locator('[data-testid="notebook-example-seeded"]'),
    ).toHaveText('seeded');
  });

  /* ---------------------------------------------------------------- *
   * Filtering, drafts, and the links out.
   * ---------------------------------------------------------------- */

  test('names tags rather than their IRIs', async ({ page }) => {
    await openLibrary(page);
    await expect(cell(page, 'product-search').locator('.tag-chip')).toHaveText('catalogue');
    await expect(page.locator('.page-meta .tag-filter').first()).toHaveText('catalogue');
  });

  test('filters the document by tag while leaving the contents complete', async ({ page }) => {
    await openLibrary(page);
    await page.locator('.page-meta .tag-filter', { hasText: 'stock' }).click();
    await expect(page.locator('[data-testid^="notebook-cell-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="notebook-toc-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="notebook-toc-product-search"]')).toHaveClass(/dimmed/);
  });

  test('filters by text from the contents rail', async ({ page }) => {
    await openLibrary(page);
    await page.locator('.contents__filter-input').fill('stock');
    await expect(page.locator('[data-testid^="notebook-cell-"]')).toHaveCount(1);
  });

  test('says so, clearably, when nothing matches', async ({ page }) => {
    await openLibrary(page);
    await page.locator('.contents__filter-input').fill('nothing matches this');
    await expect(page.locator('[data-testid^="notebook-cell-"]')).toHaveCount(0);
    await expect(page.locator('.notice')).toContainText('Nothing matches');
    await page.locator('.link-button').click();
    await expect(page.locator('[data-testid^="notebook-cell-"]')).toHaveCount(3);
  });

  test('names what it could not carry, with the reason and a way in', async ({ page }) => {
    await openLibrary(page);
    const contents = page.locator('[data-testid="notebook-contents"]');
    await expect(contents).toContainText('Not included');
    await expect(contents).toContainText(EXPORT_BUNDLE.skipped[0].name);
    await expect(contents).toContainText(EXPORT_BUNDLE.skipped[0].reason);
  });

  test('never edits: the cell links out to the editor instead', async ({ page }) => {
    await openLibrary(page);
    await expect(cell(page, 'product-search').locator('.cell__link').first()).toHaveText(/Open in editor/);
    await expect(page.locator('.cell .cm-editor[contenteditable="true"]')).toHaveCount(0);
  });

  test('is reachable from the rail, and reaches Build from its header', async ({ page }) => {
    await openLibrary(page);
    await page.locator('.header-actions a', { hasText: 'Build' }).click();
    await expect(page).toHaveURL(/\/build/);
    await page.locator('.notebook-link').click();
    await expect(page).toHaveURL(/\/library/);
  });

  test('fetches the HTML export rather than navigating, so the token goes with it', async ({ page }) => {
    await openLibrary(page);
    const request = page.waitForRequest(
      (candidate) => candidate.url().includes('format=html') && candidate.method() === 'GET',
    );
    await page.getByRole('button', { name: /Export as HTML/ }).click();
    const sent = await request;
    // A bare <a href> would be a navigation, which carries no headers of ours.
    expect(sent.resourceType()).not.toBe('document');
  });
});
