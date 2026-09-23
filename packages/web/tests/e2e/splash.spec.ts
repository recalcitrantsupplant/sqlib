/**
 * The splash screen at `/`.
 *
 * It replaced the unscoped artifact tree, which listed every library, backend
 * and artifact beside a rail that already lists every section. What the
 * landing screen claims now is narrower and checkable: which sections this
 * deployment has, which it does not, and which libraries exist.
 *
 * The enabled/disabled distinction is carried by tone, so the assertion is on
 * `aria-disabled` rather than on a word: a disabled section keeps its place in
 * the list, and nothing in the markup spells out "enabled" for the ten that
 * are.
 */
import { test, expect } from '@playwright/test';
import { mockEntityApi, LIBRARY } from './fixtures/entities';
import { openSplash, splashLibraryRow } from './navigate';

test.describe('Splash', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page);
    await openSplash(page);
  });

  test('names the app and the sections, in rail order', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'SQLIB', level: 1 })).toBeVisible();

    const labels = await page.locator('[data-testid="app-splash"] .card-label').allTextContents();
    // The rail's own order, minus Build — which is a screen whose future is
    // unsettled, so the splash does not name it.
    expect(labels).toEqual([
      'Notebook', 'Query', 'Groups', 'Rules', 'ETL', 'Bench', 'Tests', 'Graphs', 'Tuples',
      'Argument sets', 'Backends',
    ]);
    await expect(page.locator('[data-testid="splash-section-build"]')).toHaveCount(0);
  });

  test('a section opens from its card', async ({ page }) => {
    await page.locator('[data-testid="splash-section-rules"]').click();
    await expect(page).toHaveURL(/section=rules/);
    await expect(page.locator('[data-testid="entity-list-sidebar"]')).toBeVisible();
  });

  test('the tree it replaced is gone', async ({ page }) => {
    await expect(page.locator('.nav-sidebar')).toHaveCount(0);
  });

  test('lists the libraries, and the active one is marked', async ({ page }) => {
    const row = splashLibraryRow(page, LIBRARY.name);
    await expect(row).toBeVisible();
    await expect(row.locator('.library-active')).toBeVisible();
  });

  /*
   * Rename and delete live on this screen because the rows that used to carry
   * them went with the tree. Asserted as doors — that the dialog opens — since
   * what each dialog then does is its own spec.
   */
  test('a library row opens rename and delete', async ({ page }) => {
    await page.locator(`[data-testid="splash-library-edit-${LIBRARY.id}"]`).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator(`[data-testid="splash-library-delete-${LIBRARY.id}"]`).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
  });

  /*
   * About lives here rather than on a page of its own: which build this is and
   * where the source and docs are gets read once, and a destination nobody
   * navigates to is a worse home for it than the screen they land on. The
   * version is asserted as a shape, not a value — it changes every release.
   */
  test('says which build is running, and links to the source and the docs', async ({ page }) => {
    const about = page.locator('[data-testid="splash-about"]');
    await expect(about.locator('[data-testid="splash-version"]')).toContainText(/Version \S+/);

    const source = about.getByRole('link', { name: 'Source' });
    await expect(source).toHaveAttribute('href', 'https://github.com/recalcitrantsupplant/sqlib');
    await expect(about.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
      'href',
      'https://github.com/recalcitrantsupplant/sqlib/tree/main/docs',
    );
  });

  test('the same version is reachable from Settings, on any screen', async ({ page }) => {
    await page.locator('.nav-rail .rail-icon-button[aria-label="Settings"]').click();
    await expect(page.locator('[data-testid="settings-version"]')).toContainText(/SQLIB \S+/);
  });

  /*
   * The mark at the head of the rail is the way back. On `/` that is a state
   * reset rather than a navigation — the page reads the URL once at setup, so
   * pushing `/` over `/?section=rules` would move the address bar and leave
   * the section open.
   */
  test('the rail mark comes back to the splash from a section', async ({ page }) => {
    await page.locator('[data-testid="splash-section-rules"]').click();
    await expect(page.locator('[data-testid="entity-list-sidebar"]')).toBeVisible();

    await page.locator('[data-testid="library-home"]').click();

    await expect(page.locator('[data-testid="app-splash"]')).toBeVisible();
    await expect(page.locator('[data-testid="entity-list-sidebar"]')).toHaveCount(0);
    await expect(page).not.toHaveURL(/section=/);
  });

  test('the rail mark comes back to the splash from the notebook', async ({ page }) => {
    await page.locator('.nav-rail .rail-button').filter({ hasText: 'Notebook' }).click();
    await expect(page).toHaveURL(/\/notebook(\?|$)/);

    await page.locator('[data-testid="library-home"]').click();

    await expect(page).toHaveURL(/\/(\?|$)/);
    await expect(page.locator('[data-testid="app-splash"]')).toBeVisible();
  });

  test('New library opens the Add Library dialog', async ({ page }) => {
    await page.locator('[data-testid="splash-library-create"]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Add Library')).toBeVisible();
  });
});
