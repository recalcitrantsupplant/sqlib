/**
 * The splash screen at `/`.
 *
 * Three zones, in reading order: a command field, a grid of what this library
 * holds, and a log of what changed. The grid replaced the list of sections —
 * same entries, same order, now carrying the count each one has — and the list
 * of libraries moved behind the Libraries card, because a deployment has a
 * handful of them and you pick one and forget it.
 *
 * The enabled/disabled distinction is still carried by tone, so the assertion
 * is on `aria-disabled` rather than on a word: a disabled section keeps its
 * place in the grid, and nothing in the markup spells out "enabled" for the ten
 * that are.
 */
import { test, expect } from '@playwright/test';
import { mockEntityApi, LIBRARY, QUERY } from './fixtures/entities';
import { openSplash, openSplashLibraries, splashLibraryRow } from './navigate';

test.describe('Splash', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page);
    await openSplash(page);
  });

  test('names the app and every section, in grid order', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'SQLIB', level: 1 })).toBeVisible();

    const labels = await page.locator('[data-testid="app-splash"] .card-label').allTextContents();
    // Libraries first, then what the library defines; Backends heads the second
    // row, where the inputs start; evidence last. Build is not named — it is a
    // screen whose future is unsettled.
    expect(labels).toEqual([
      'Libraries', 'Notebook', 'Query', 'Groups', 'Rules', 'ETL',
      'Backends', 'Graphs', 'Tuples', 'Argument sets',
      'Tests', 'Bench',
    ]);
    await expect(page.locator('[data-testid="splash-section-build"]')).toHaveCount(0);
  });

  /*
   * The count is the point of the card. The fixture library holds one query, so
   * the Query card reads 1 and the Tuples card — which the fixture has none of
   * — reads 0. Zero is a fact about the library; the em dash is reserved for a
   * section this deployment does not have.
   */
  test('each card carries the count the library holds', async ({ page }) => {
    await expect(page.locator('[data-testid="splash-section-queries"] .card-count')).toHaveText('1');
    await expect(page.locator('[data-testid="splash-section-tupleSets"] .card-count')).toHaveText('0');
    await expect(page.locator('[data-testid="splash-libraries"] .card-count')).toHaveText('1');
  });

  test('a section opens from its card', async ({ page }) => {
    await page.locator('[data-testid="splash-section-rules"]').click();
    await expect(page).toHaveURL(/section=rules/);
    await expect(page.locator('[data-testid="entity-list-sidebar"]')).toBeVisible();
  });

  test('the field opens the command palette', async ({ page }) => {
    await page.locator('[data-testid="splash-command-field"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('the tree it replaced is gone', async ({ page }) => {
    await expect(page.locator('.nav-sidebar')).toHaveCount(0);
  });

  /*
   * The log is derived from the records themselves — `dateCreated` and
   * `dateModified` — so it says the same thing to a tab opened tomorrow. The
   * fixture stamps its query as modified after it was created, so the row reads
   * "updated" and carries the version it stands at.
   */
  test('the activity log names what changed, and opens it', async ({ page }) => {
    const row = page.locator('[data-testid="splash-activity"] .row').filter({ hasText: QUERY.name });
    await expect(row.locator('.row-verb')).toHaveText('updated');
    await expect(row.locator('.row-version')).toHaveText('v1');

    await row.locator('.row-what').click();
    await expect(page.locator('[data-testid="entity-list-sidebar"]')).toBeVisible();
  });

  test('lists the libraries behind the Libraries card, and marks the active one', async ({ page }) => {
    await expect(page.locator('[data-testid="splash-libraries-panel"]')).toHaveCount(0);

    await openSplashLibraries(page);

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
    await openSplashLibraries(page);

    await page.locator(`[data-testid="splash-library-edit-${LIBRARY.id}"]`).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator(`[data-testid="splash-library-delete-${LIBRARY.id}"]`).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
  });

  /*
   * About lives here rather than on a page of its own: which build this is and
   * where the source and docs are gets read once, and a destination nobody
   * navigates to is a worse home for it than the screen they land on. It now
   * shares the strip with the two facts that would otherwise want a panel each.
   * The version is asserted as a shape, not a value — it changes every release.
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

  /* The backend the library runs against, beside the build it is running. */
  test('the strip names the library’s default backend', async ({ page }) => {
    await expect(page.locator('[data-testid="splash-backend"]')).toContainText('Visual Backend');
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
    await openSplashLibraries(page);
    await page.locator('[data-testid="splash-library-create"]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Add Library')).toBeVisible();
  });
});
