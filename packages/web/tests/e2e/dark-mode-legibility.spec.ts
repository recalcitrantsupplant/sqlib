/**
 * Dark mode, on the screens the first pass never rendered in it (issue #38).
 *
 * The @visual baselines cover the same screens and cannot replace this: a
 * baseline says the pixels did not move, not that the text can be read, and it
 * is excluded from CI because it rasterises differently per machine. These
 * assertions are computed styles, so they hold anywhere.
 *
 * What they pin, all of it shipped broken:
 *
 * - The theme preference is the switch. A block keyed on
 *   `prefers-color-scheme` ignored it, so pinning light under a dark OS painted
 *   a dark results viewer into a light app, and pinning dark under a light OS
 *   left a light one in a dark app. Both directions are checked, which is why
 *   `colorScheme` is set against the preference in each case.
 * - Text on a chromatic fill does not flip with the theme, because the fill
 *   does not: --action stays blue, so its ink stays white.
 * - A ramp step with no dark value keeps the light theme's direction and
 *   disappears into the dark surface.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockEntityApi, QUERY } from './fixtures/entities';
import { openCreateLibraryDialog, openSavedEntity, openSplash } from './navigate';
import { textContrast, backgroundLuminance } from './contrast';

/** WCAG AA for body text. */
const AA = 4.5;

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((value) => {
    localStorage.setItem(
      'sparql-query-lib-settings',
      JSON.stringify({ hofstadterMode: false, prefixAbbreviationEnabled: true, theme: value }),
    );
  }, theme);
}

async function openApp(page: Page) {
  await openSplash(page);
}

/** The rows of the results table, once the fixture query's response is in it. */
const RESULT_CELLS = '.results-viewer td:not(.row-number-cell)';

/** The query editor with the fixture query run, so the results table is up. */
async function runFixtureQuery(page: Page) {
  await openSavedEntity(page, 'queries', QUERY.id);
  await expect(page.locator('.query-work-area')).toBeVisible();
  await page.locator('[data-testid="run-bar-run"]').click();
  /*
   * The pane is visible before the response is in it — the body renders its
   * loading state first — so waiting on the pane read an empty table on a
   * machine slower than this one. The cell being measured is the wait.
   */
  await expect(page.locator(RESULT_CELLS).first()).toBeVisible();
}

test.describe('dark mode', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page);
    await page.setViewportSize({ width: 1600, height: 950 });
  });

  /*
   * The OS says light and the preference says dark, so anything that reads the
   * OS instead of the preference renders its light styling here.
   */
  test.describe('pinned dark under a light OS', () => {
    test.use({ colorScheme: 'light' });

    test('the results viewer is dark, and its rows read against it', async ({ page }) => {
      await setTheme(page, 'dark');
      await runFixtureQuery(page);

      await expect(page.locator('html')).toHaveClass(/dark/);
      expect(await backgroundLuminance(page, '.results-viewer .viewer-body')).toBeLessThan(0.1);
      expect(await textContrast(page, RESULT_CELLS)).toBeGreaterThan(AA);
    });

    test('the details panel Delete button reads against the panel', async ({ page }) => {
      await setTheme(page, 'dark');
      await openSavedEntity(page, 'queries', QUERY.id);
      await expect(page.locator('.details-panel .delete-button')).toBeVisible();

      // --danger-active had no dark value: it stayed --red-700, at 2.75:1.
      expect(await textContrast(page, '.details-panel .delete-button')).toBeGreaterThan(3);
    });
  });

  /*
   * The mirror image: the OS says dark and the preference says light. A block
   * keyed on the OS paints its dark styling into a light app here.
   */
  test.describe('pinned light under a dark OS', () => {
    test.use({ colorScheme: 'dark' });

    test('the results viewer stays light, and its rows read against it', async ({ page }) => {
      await setTheme(page, 'light');
      await runFixtureQuery(page);

      await expect(page.locator('html')).not.toHaveClass(/dark/);
      expect(await backgroundLuminance(page, '.results-viewer .viewer-body')).toBeGreaterThan(0.5);
      expect(await textContrast(page, RESULT_CELLS)).toBeGreaterThan(AA);
    });
  });

  /*
   * --action is the same blue in both themes, so the ink on it is the same
   * white in both. It was --ink-inverse, which is white in light and near-black
   * in dark, so every primary button flipped under a fill that had not.
   */
  test('a primary button keeps its ink across themes', async ({ page }) => {
    const inkOnAction = async (theme: 'light' | 'dark') => {
      await setTheme(page, theme);
      await openApp(page);
      await openCreateLibraryDialog(page);
      return page.locator('.btn-submit').evaluate((el) => getComputedStyle(el).color);
    };

    expect(await inkOnAction('dark')).toBe(await inkOnAction('light'));
  });
});
