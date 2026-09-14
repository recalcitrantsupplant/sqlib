import { test, expect, type Page } from '@playwright/test';
import { mockEntityApi, LIBRARY, QUERY_GROUP } from './fixtures/entities';

/**
 * The Groups sidebar — the second section to leave the artifact tree.
 *
 * Groups take the same flat list as Queries, and now the same scratch cluster
 * too: a canvas serializes, so `+ New` opens an untitled one rather than a
 * creation dialog and Save creates the group and its v1 together.
 */

const SECOND_GROUP = {
  id: 'urn:sqlib:query-group:second',
  name: 'Alphabetically first',
  description: 'A second fixture group, for filtering and sorting',
  isPartOf: LIBRARY.id,
  // As above: no number in the IRI, so the badge cannot come from parsing it.
  currentVersion: 'urn:sqlib:group-version:4b7e02',
  currentVersionNumber: 2,
  dateCreated: '2026-01-01T00:00:00Z',
  dateModified: '2026-01-02T00:00:00Z',
};

async function mockTwoGroups(page: Page) {
  await mockEntityApi(page, {
    extraRoutes: [
      [/\/query-groups$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([QUERY_GROUP, SECOND_GROUP]),
        });
      }],
    ],
  });
}

async function openGroups(page: Page) {
  await page.goto('/?section=queryGroups', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="entity-list-sidebar"]');
}

test.describe('Groups sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await mockTwoGroups(page);
  });

  test('replaces the tree for this section', async ({ page }) => {
    await openGroups(page);
    await expect(page.locator('[data-testid="entity-list-sidebar"]')).toBeVisible();
    await expect(page.locator('.nav-sidebar')).toHaveCount(0);
  });

  test('is headed Groups, not Queries', async ({ page }) => {
    await openGroups(page);
    await expect(page.locator('.section-name')).toHaveText('Groups');
  });

  test('lists the library’s groups, sorted, with their versions', async ({ page }) => {
    await openGroups(page);

    const rows = page.locator('[data-testid="saved-row"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Alphabetically first');
    await expect(rows.first()).toContainText('v2');
    await expect(page.locator('[data-testid="section-count"]')).toHaveText('2');
  });

  test('selecting a group opens it in the canvas work area', async ({ page }) => {
    await openGroups(page);
    await page.locator('[data-testid="saved-row"]').filter({ hasText: QUERY_GROUP.name }).click();

    await expect(page.locator('.querygroup-work-area')).toBeVisible();
    // The router writes the IRI unescaped, so match it as written.
    await expect(page).toHaveURL(new RegExp(`queryGroup=${QUERY_GROUP.id}`));
  });

  test('the selected group is the highlighted row', async ({ page }) => {
    await openGroups(page);
    const row = page.locator('[data-testid="saved-row"]').filter({ hasText: QUERY_GROUP.name });
    await row.click();
    await expect(row).toHaveClass(/selected/);
  });

  test('the filter narrows the list', async ({ page }) => {
    await openGroups(page);
    await page.locator('[data-testid="entity-filter"]').fill('Alphabet');

    await expect(page.locator('[data-testid="saved-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="saved-row"]')).toContainText('Alphabetically first');
  });

  test('the filter says so when nothing matches', async ({ page }) => {
    await openGroups(page);
    await page.locator('[data-testid="entity-filter"]').fill('nothing matches this');
    await expect(page.locator('.list-empty')).toContainText('Nothing matches');
  });

  test('+ New opens an untitled canvas rather than a dialog', async ({ page }) => {
    await openGroups(page);
    await page.locator('[data-testid="new-scratch"]').click();

    await expect(page).toHaveURL(/scratch=/);
    await expect(page.locator('[data-testid="scratch-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="scratch-chip"]')).toBeVisible();
  });

  // One switcher for the whole window: it lives at the head of the nav rail, so
  // every section is under the same library rather than each list carrying its
  // own control.
  test('the rail names the library both sections are under', async ({ page }) => {
    await openGroups(page);
    await expect(page.locator('.nav-rail [data-testid="library-switcher"]')).toHaveAttribute(
      'title',
      `Library — ${LIBRARY.name}`,
    );
  });

  test('the rail moves between the two flat sections', async ({ page }) => {
    await openGroups(page);
    await expect(page.locator('.section-name')).toHaveText('Groups');

    await page.locator('.nav-rail .rail-button').filter({ hasText: 'Query' }).first().click();
    await expect(page.locator('.section-name')).toHaveText('Queries');

    await page.locator('.nav-rail .rail-button').filter({ hasText: 'Groups' }).click();
    await expect(page.locator('.section-name')).toHaveText('Groups');
  });
});
