import { test, expect, type Page } from '@playwright/test';
import { mockEntityApi } from './fixtures/entities';

/**
 * Sidebar → work area wiring.
 *
 * Rewritten against the current markup. Every selector this used to carry —
 * `.lib-label`, `.detail-view`, `.editor-view`, `.lib-section`, `.section`,
 * `.add-btn` — had been renamed, and the spec ran against a live API that is
 * not stood up for the suite, so it had been failing silently for a long time.
 *
 * The visual suite renders these same screens, but it asserts pixels; these
 * are the functional assertions that selecting a thing opens the right editor.
 */

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.nav-sidebar');
}

/** The Libraries section starts expanded; only the library itself is collapsed. */
async function expandLibrary(page: Page) {
  await page.locator('.library-toggle').first().click();
  await expect(page.locator('.library-subitems').first()).toBeVisible();
}

async function selectItem(page: Page, category: string, itemName: string) {
  await expandLibrary(page);
  await page.locator('.category-header').filter({ hasText: category }).first().click();
  await page.locator('.item-button').filter({ hasText: itemName }).first().click();
}

test.describe('Main Panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page);
    await openApp(page);
  });

  test('should display sidebar with Libraries and Backends sections', async ({ page }) => {
    const sidebar = page.locator('.nav-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('.nav-section').filter({ hasText: 'Libraries' })).toBeVisible();
    await expect(sidebar.locator('.nav-section').filter({ hasText: 'Backends' })).toBeVisible();
  });

  test('shows the empty state when nothing is selected', async ({ page }) => {
    // The ad-hoc editor used to sit here. It is gone: an unsaved query is an
    // item in the Queries list, not the screen you get for choosing nothing.
    await expect(page.locator('.ad-hoc-work-area')).toHaveCount(0);
    await expect(page.locator('.content-placeholder')).toBeVisible();
  });

  test('should show library details when a library is selected', async ({ page }) => {
    await page.locator('.library-toggle').first().click();
    await expect(page.getByText('Visual Library')).toBeVisible();
  });

  test('should show the query editor when a query is selected', async ({ page }) => {
    await selectItem(page, 'Queries', 'Countries By Population');
    await expect(page.locator('.query-work-area')).toBeVisible();
  });

  test('should show the query group canvas when a query group is selected', async ({ page }) => {
    await selectItem(page, 'Query Groups', 'Country Enrichment Flow');
    await expect(page.locator('.querygroup-work-area')).toBeVisible();
  });

  test('should show the rule set editor when a rule set is selected', async ({ page }) => {
    await selectItem(page, 'Rule Sets', 'Family Closure Rules');
    await expect(page.locator('.ruleset-work-area')).toBeVisible();
  });

  test('should open the create library dialog', async ({ page }) => {
    await page.locator('.nav-section').filter({ hasText: 'Libraries' }).locator('.add-button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Add Library')).toBeVisible();
  });

  // Backends is a record page now: + in the tree opens the Backends section
  // with an unsaved record, and there is no dialog to open (backends UI doc
  // §Creation).
  test('should start a new backend as a draft record, not a dialog', async ({ page }) => {
    await page.locator('.nav-section').filter({ hasText: 'Backends' }).locator('.add-button').click();

    await expect(page.locator('[data-testid="backend-list-sidebar"]')).toBeVisible();
    await expect(page.locator('[data-testid="backend-draft-row"]')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
