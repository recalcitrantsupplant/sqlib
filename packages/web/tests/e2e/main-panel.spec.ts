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
