import { test, expect } from '@playwright/test';
import { mockEntityApi, QUERY, QUERY_GROUP, RULE_SET } from './fixtures/entities';
import { openSplash, openSavedEntity, openCreateLibraryDialog } from './navigate';

/**
 * Sidebar → work area wiring.
 *
 * Rewritten twice: once against renamed markup, and again when the artifact
 * tree went. Selecting a thing now means picking its section in the rail and
 * its row in that section's sidebar, so that is what these drive — the
 * assertion has not changed, only the route to it.
 *
 * The visual suite renders these same screens, but it asserts pixels; these
 * are the functional assertions that selecting a thing opens the right editor.
 */

test.describe('Main Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page);
    await openSplash(page);
  });

  test('shows the splash when nothing is selected', async ({ page }) => {
    // The ad-hoc editor used to sit here, then an empty placeholder. Both are
    // gone: an unsaved query is an item in the Queries list, and the screen
    // you get for choosing nothing says what the deployment has.
    await expect(page.locator('.ad-hoc-work-area')).toHaveCount(0);
    await expect(page.locator('[data-testid="app-splash"]')).toBeVisible();
  });

  test('exports the active library, carrying only what is ticked', async ({ page }) => {
    await page.route(/\/libraries\/[^/]+\/export-bundle/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bundle: { version: 1, library: { id: 'urn:x' }, queries: {} }, skipped: [] }),
      }),
    );

    await page.getByTestId('splash-export').click();
    await expect(page.getByTestId('library-export-dialog')).toBeVisible();

    // Every member is a choice, and every choice starts ticked, as the server carries it.
    const members = ['library-export-queries', 'library-export-groups', 'library-export-etl', 'library-export-rule-sets'];
    for (const id of members) await expect(page.getByTestId(id)).toHaveAttribute('aria-checked', 'true');

    // Unticking queries takes its examples with it.
    await page.getByTestId('library-export-queries').click();
    await expect(page.getByTestId('library-export-examples')).toBeDisabled();
    await expect(page.getByTestId('library-export-examples')).toHaveAttribute('aria-checked', 'false');

    // Nothing ticked is nothing to export: the buttons say so rather than the server.
    for (const id of members.slice(1)) await page.getByTestId(id).click();
    await expect(page.getByTestId('library-export-nothing')).toBeVisible();
    await expect(page.getByTestId('library-export-download')).toBeDisabled();
    await expect(page.getByTestId('library-export-html')).toBeDisabled();

    // Rule sets alone: a bundle, but no page, which shows queries and groups.
    await page.getByTestId('library-export-rule-sets').click();
    await expect(page.getByTestId('library-export-html')).toBeDisabled();

    const exported = page.waitForRequest((request) => /\/export-bundle\?/.test(request.url()));
    const download = page.waitForEvent('download');
    await page.getByTestId('library-export-download').click();

    const params = new URL((await exported).url()).searchParams;
    expect(params.get('queries')).toBe('false');
    expect(params.get('groups')).toBe('false');
    expect(params.get('etl')).toBe('false');
    expect(params.has('ruleSets')).toBe(false);
    expect(params.get('examples')).toBe('none');
    expect((await download).suggestedFilename()).toMatch(/\.bundle\.json$/);
  });

  test('should show the query editor when a query is selected', async ({ page }) => {
    await openSavedEntity(page, 'queries', QUERY.id);
    await expect(page.locator('.query-work-area')).toBeVisible();
  });

  test('should show the query group canvas when a query group is selected', async ({ page }) => {
    await openSavedEntity(page, 'queryGroups', QUERY_GROUP.id);
    await expect(page.locator('.querygroup-work-area')).toBeVisible();
  });

  test('should show the rule set editor when a rule set is selected', async ({ page }) => {
    await openSavedEntity(page, 'rules', RULE_SET.id);
    await expect(page.locator('.ruleset-work-area')).toBeVisible();
  });

  test('should open the create library dialog', async ({ page }) => {
    await openCreateLibraryDialog(page);
    await expect(page.getByRole('dialog').getByText('Add Library')).toBeVisible();
  });

  // Backends is a record page: + in the Backends sidebar opens an unsaved
  // record, and there is no dialog to open (backends UI doc §Creation).
  test('should start a new backend as a draft record, not a dialog', async ({ page }) => {
    await page.goto('/?section=backends', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="new-backend"]').click();

    await expect(page.locator('[data-testid="backend-draft-row"]')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
