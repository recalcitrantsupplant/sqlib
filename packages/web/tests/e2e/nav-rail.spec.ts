import { test, expect, type Page } from '@playwright/test';
import { mockEntityApi, QUERY } from './fixtures/entities';

/**
 * The 56px primary nav rail.
 *
 * Two things are being asserted, and they are different: that the rail is a
 * router (Library and Build are screens), and that it is a scope (the rest
 * open their own sidebar). The scope is opt-in — with no rail entry chosen the
 * app shows the splash and no sidebar at all — so "unscoped by default" is
 * itself a test, not an accident.
 */

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.nav-rail');
}

function railButton(page: Page, label: string) {
  return page.locator('.nav-rail .rail-button').filter({ hasText: label });
}

test.describe('Nav rail', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page);
    await openApp(page);
  });

  test('renders Notebook, then the library sections, then Build, then Backends', async ({ page }) => {
    const labels = await page.locator('.nav-rail .rail-button .rail-label').allTextContents();
    /*
     * v2 order (nav doc §2). No Play: a playground is an unsaved item, not a
     * place. Tests sits beside Bench because the two invoke the same subjects
     * the same way — one judges the result, the other measures it.
     *
     * Data and Tuples come last of the library sections, and in that order,
     * because they are what the others consume: the library's two static
     * assets, differing in the shape of their content rather than in kind. A
     * data graph is the store something runs against; a tuple set is rows
     * spliced into a VALUES clause and consumed. RDF input is data, tabular
     * input is a parameter.
     *
     * Then Argument sets, which is the third of that trio: Graphs and Tuples
     * are pieces you keep, an argument set is one filled-in call to a query or
     * a group. "Data" became "Graphs" in the same change — the old label said
     * what a graph was *for*, which stopped being the whole story once a backend
     * could be hydrated from one.
     *
     * Notebook leads, because it is the library's front page — the screen you
     * show someone before they know which type they want, so everything under
     * it reads as a drill-down from it. It is called Notebook rather than
     * Library because the library is now the whole window's scope, named once by
     * the switcher at the head of the rail.
     */
    expect(labels).toEqual([
      'Notebook', 'Query', 'Groups', 'Rules', 'ETL', 'Bench', 'Tests', 'Graphs', 'Tuples',
      'Argument sets', 'Build', 'Backends',
    ]);
  });

  test('separates Backends from the library-scoped sections', async ({ page }) => {
    // The divider is the whole explanation for why connections are not in a
    // library: it is account-level, so it sits outside the sections above it.
    await expect(page.locator('.nav-rail .rail-divider')).toHaveCount(1);
    await expect(railButton(page, 'Backends')).toHaveAttribute(
      'title',
      'Account-level — shared by every library'
    );
  });

  test('Notebook navigates to the library page, the rail\'s other screen', async ({ page }) => {
    await railButton(page, 'Notebook').click();
    // Same shape as Build below: a screen, not a scope, and it self-selects a
    // library once the store resolves, so the path is what can be anchored on.
    await expect(page).toHaveURL(/\/library(\?|$)/);
    await expect(page.locator('.library-layout')).toBeVisible();
    await expect(page.locator('.nav-sidebar')).toHaveCount(0);
  });

  test('Build navigates to the Build screen', async ({ page }) => {
    await railButton(page, 'Build').click();
    // Path only, not the whole URL: Build self-selects the first library once
    // the store resolves and rewrites itself to `/build?library=…`. Anchoring
    // on `/build$` only passed while the machine was slow enough to be observed
    // mid-flight — the self-hosted runner loses that race every time.
    await expect(page).toHaveURL(/\/build(\?|$)/);
    await expect(page.locator('.build-layout')).toBeVisible();
    // §2: no second sidebar inside Build.
    await expect(page.locator('.nav-sidebar')).toHaveCount(0);
  });

  test('the rail comes back out of Build, carrying the section', async ({ page }) => {
    await railButton(page, 'Build').click();
    await expect(page.locator('.build-layout')).toBeVisible();

    await railButton(page, 'Backends').click();
    await expect(page).toHaveURL(/section=backends/);
    await expect(page.locator('[data-testid="backend-list-sidebar"]')).toBeVisible();
  });

  test('starts unscoped — the splash, and no sidebar', async ({ page }) => {
    await expect(page.locator('[data-testid="app-splash"]')).toBeVisible();
    await expect(page.locator('[data-testid="entity-list-sidebar"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="backend-list-sidebar"]')).toHaveCount(0);
    // The tree that used to be this state is gone, not filtered: it was a
    // second navigator beside a rail that already lists every section.
    await expect(page.locator('.nav-sidebar')).toHaveCount(0);
  });

  test('Query leaves the tree behind for the flat sidebar', async ({ page }) => {
    await railButton(page, 'Query').click();
    await expect(page).toHaveURL(/section=queries/);

    // Queries is the first section converted: it does not scope the tree, it
    // replaces it. Coverage of the list itself is in query-sidebar.spec.ts.
    await expect(page.locator('[data-testid="entity-list-sidebar"]')).toBeVisible();
    await expect(page.locator('.nav-sidebar')).toHaveCount(0);
  });

  /*
   * Rules once listed three kinds under one rail entry, because a rule and a
   * data block each had a work area to be opened into. They do not any more —
   * a rule set is the smallest editable unit, and its editor holds both — so
   * the section lists rule sets and the subheadings that told the three apart
   * have nothing left to separate.
   */
  test('Rules lists rule sets alone, without subheadings', async ({ page }) => {
    await railButton(page, 'Rules').click();
    await page.waitForSelector('[data-testid="entity-list-sidebar"]');

    await expect(page.locator('[data-testid="saved-row"]').first()).toBeVisible();
    await expect(page.locator('.group-name')).toHaveCount(0);
  });

  /*
   * Backends was the last section still scoping the tree. It has its own list
   * and record page now, so — like every other section — the tree is gone
   * rather than filtered (backends UI doc §Layout).
   */
  test('Backends leaves the tree behind for its own list', async ({ page }) => {
    await railButton(page, 'Backends').click();

    await expect(page.locator('[data-testid="backend-list-sidebar"]')).toBeVisible();
    await expect(page.locator('.nav-sidebar')).toHaveCount(0);
  });

  test('clicking the active entry clears the scope', async ({ page }) => {
    await railButton(page, 'Backends').click();
    await expect(page.locator('[data-testid="backend-list-sidebar"]')).toBeVisible();

    await railButton(page, 'Backends').click();
    await expect(page).not.toHaveURL(/section=/);
    await expect(page.locator('[data-testid="app-splash"]')).toBeVisible();
  });

  test('restores the scope from the URL', async ({ page }) => {
    await page.goto('/?section=backends', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.nav-rail');

    await expect(railButton(page, 'Backends')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-testid="backend-list-sidebar"]')).toBeVisible();
  });

  /*
   * A link that names a record opens it whatever the URL says about sections,
   * and the rail follows the record. The highlight is not a scope: no section
   * was picked, so nothing else on the screen moves.
   */
  test('highlights the entry matching the open artifact without scoping', async ({ page }) => {
    await page.goto(`/?query=${encodeURIComponent(QUERY.id)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.nav-rail');

    await expect(page.locator('.query-work-area')).toBeVisible();
    await expect(railButton(page, 'Query')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-testid="entity-list-sidebar"]')).toHaveCount(0);
  });

  test('Settings opens from the rail footer', async ({ page }) => {
    await page.locator('.nav-rail .rail-icon-button[aria-label="Settings"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
