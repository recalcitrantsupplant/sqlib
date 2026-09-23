/**
 * The interactions under measurement, and the budgets they must meet.
 *
 * Budgets are on `timeToVisible` (what the user feels) and `processing` (how
 * much work the click handler does on the main thread). They are set against
 * the PRODUCTION build only — the dev server's on-demand compilation makes
 * first-open timings meaningless as a regression signal.
 */
import type { Page } from '@playwright/test';

export type Interaction = {
  name: string;
  /** Path to open instead of the app root, for interactions with a fixture page. */
  url?: string;
  /** Get the app into the state where `trigger` is clickable. */
  setup: (page: Page) => Promise<void>;
  trigger: string;
  appears: string;
  /** Subtree whose CSS animations must finish before the open is "settled". */
  settleRoot?: string;
  /**
   * A JS expression, evaluated in the page every frame, that is true once the
   * interaction has finished. Supply this for anything that renders rather than
   * animates: with no animation in the subtree the animation clock settles at
   * `visibleAt`, which fires when the container gets a box — after the first
   * row paints, not the last — and would report a table render as instant.
   */
  settleWhen?: string;
  /** Return to the pre-click state so the interaction can be repeated. */
  reset: (page: Page) => Promise<void>;
  /**
   * Why this interaction cannot currently be measured. Set it rather than
   * deleting the entry: a benchmark that is removed stops being missed, and
   * these exist because someone found a real regression through them.
   */
  skip?: string;
  budget: { timeToSettled: number; jankyFrames: number; processing: number };
};

const noop = async () => {};

/** Put every table into a term display mode, from the results action bar. */
async function setTermDisplay(page: Page, mode: 'prefixed' | 'full'): Promise<void> {
  await page.locator(`[data-testid="term-display-${mode}"]`).first().click();
}

export const INTERACTIONS: Interaction[] = [
  {
    // The user's stated fast baseline: a plain dialog with no editor in it.
    name: 'sidebar: Add Library dialog',
    setup: noop,
    trigger: 'button[title="Add Library"]',
    appears: '[role="dialog"]',
    settleRoot: '[role="dialog"]',
    reset: async (page) => {
      await page.keyboard.press('Escape');
      await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
    },
    // Measured ~240ms / 1 janky frame; radix's own 200ms zoom dominates.
    budget: { timeToSettled: 450, jankyFrames: 3, processing: 60 },
  },
  {
    // No dialog to measure any more: the + opens the Backends section with an
    // unsaved record in it, so what is being timed is a section switch plus a
    // record render.
    name: 'sidebar: new backend record',
    setup: noop,
    trigger: 'button[title="Add Backend"]',
    appears: '[data-testid="backend-work-area"]',
    settleRoot: '[data-testid="backend-work-area"]',
    reset: async (page) => {
      await page.locator('[data-testid="discard-backend"]').click();
      await page.locator('.nav-rail .rail-button').filter({ hasText: 'Backends' }).click();
    },
    budget: { timeToSettled: 450, jankyFrames: 3, processing: 60 },
  },
  {
    /*
     * Was the slow one: 353ms and 9 dropped frames when the overlay still had
     * `backdrop-filter: blur(4px)` and a 0.3s slide. Worth restoring — it is
     * the only entry here that ever caught anything.
     *
     * Broken, and had been failing silently on `waitFor` rather than measuring:
     * the trigger lives in EtlPlayground, which stopped being a destination of
     * its own, and the button is further gated on
     * `activeInspectorTab === 'results' && executionResult`. Reaching it now
     * means mocking `POST /playground/etl/execute` in setup, running the job,
     * and switching the inspector to Results before the overlay can open.
     */
    name: 'playground: expand editor overlay',
    url: '/?section=etl',
    skip: 'needs a mocked POST /playground/etl/execute before the trigger exists',
    setup: noop,
    trigger: 'button[title="Focus Mode"]',
    appears: '.focus-overlay .cm-editor',
    settleRoot: '.focus-overlay',
    reset: async (page) => {
      await page.locator('.focus-overlay button[title="Close Focus Mode"]').click();
      await page.locator('.focus-overlay').waitFor({ state: 'detached' });
    },
    budget: { timeToSettled: 350, jankyFrames: 3, processing: 120 },
  },

  /*
   * The results table, which is the component whose speed we are protecting.
   *
   * Measured on the bench fixture rather than a query, so the dataset size is a
   * parameter and no network cost sits inside the measurement.
   *
   * The pair is deliberate. The table paginates at 25 (`initial-page-size`, see
   * QueryResultsViewer), so the painted DOM is identical at every dataset size
   * and 100 vs 1000 measured the same to within a millisecond — the cost is per
   * painted CELL, not per row. That equality is the invariant: anything that
   * makes rendering a function of dataset size (a parse over every binding, a
   * lookup that walks the data) shows up as the two entries diverging, which no
   * single-size benchmark would catch. 10000 is the canary because that is
   * where the row model TanStack builds starts to register at all: 198ms
   * against 144ms at 100.
   */
  {
    name: 'results: Table tab @100 rows',
    url: '/tests/query-results-bench?rows=100',
    setup: async (page) => {
      await page.locator('[data-testid="results-view-raw"]').click();
    },
    trigger: '[data-testid="results-view-table"]',
    appears: '.table-container',
    settleWhen: "document.querySelectorAll('.table-container tbody tr').length >= 25",
    reset: async (page) => {
      await page.locator('[data-testid="results-view-raw"]').click();
    },
    // Measured 144ms / 89ms processing / 1 janky at cpu=4.
    budget: { timeToSettled: 320, jankyFrames: 4, processing: 200 },
  },
  {
    name: 'results: Table tab @10000 rows',
    url: '/tests/query-results-bench?rows=10000',
    setup: async (page) => {
      await page.locator('[data-testid="results-view-raw"]').click();
    },
    trigger: '[data-testid="results-view-table"]',
    appears: '.table-container',
    settleWhen: "document.querySelectorAll('.table-container tbody tr').length >= 25",
    reset: async (page) => {
      await page.locator('[data-testid="results-view-raw"]').click();
    },
    // Measured 198ms / 129ms processing / 1 janky at cpu=4.
    budget: { timeToSettled: 420, jankyFrames: 4, processing: 280 },
  },
  {
    /*
     * Switching one column back to prefixed names over a loaded table: one
     * `abbreviateIri` per IRI cell in that column, re-rendered. This is the
     * interaction any change to prefix handling would regress, so it is the
     * one the ratchet exists for.
     *
     * There is no table-wide toggle any more — term display is a column
     * property, chosen in the column's own header menu — so setup puts `s`
     * into full-IRI mode and leaves the menu open on it, and the measured
     * click is the "Prefixed names" item.
     *
     * Gate `timeToSettled`, not `processing`: the click only flips a ref, so
     * the re-render lands after the handler returns and Event Timing puts it
     * at ~10ms no matter how slow the abbreviation gets. `timeToVisible` is
     * negative here by design — the table was already on screen.
     *
     * Note what this does NOT measure: `abbreviateIri` memoises, and the same
     * page of rows is on screen for every repeat, so the warm median is the cache,
     * not the lookup. Comparing abbreviation implementations needs a
     * cold-cache micro-benchmark; this entry guards the rendered path.
     */
    name: 'results: term display @1000 rows',
    url: '/tests/query-results-bench?rows=1000',
    setup: async (page) => {
      await page.locator('.table-container tbody tr').first().waitFor();
      await setTermDisplay(page, 'full');
    },
    trigger: '[data-testid="term-display-prefixed"]',
    appears: '.table-container',
    // Row 1's subject is under foaf, so once it is prefixed it stops being a URL.
    settleWhen:
      "!!document.querySelector('.table-container tbody tr td:nth-child(2)') && !document.querySelector('.table-container tbody tr td:nth-child(2)').textContent.trim().startsWith('http')",
    reset: async (page) => {
      await setTermDisplay(page, 'full');
    },
    // Measured 40ms settled / 1 janky at cpu=4. Small numbers carry more noise,
    // so this is 3x rather than the 2x the larger entries use.
    budget: { timeToSettled: 120, jankyFrames: 4, processing: 60 },
  },
];
