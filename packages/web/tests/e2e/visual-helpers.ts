import type { Page } from '@playwright/test';

/**
 * What every `@visual` spec has to do before it takes a picture.
 *
 * Extracted from `visual-regression.spec.ts` when the canvas states got a spec
 * of their own (#47 item 5). Moved verbatim rather than rewritten: these three
 * are the reason the committed baselines are stable, and each of them earned a
 * line of that stability the hard way — the comments say which.
 */

export async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    localStorage.setItem(
      'sparql-query-lib-settings',
      JSON.stringify({ hofstadterMode: false, prefixAbbreviationEnabled: true, theme: t }),
    );
  }, theme);
}

/**
 * A fixed wall clock. The fixtures carry fixed dates, but the app renders them
 * through `formatRelativeTime`, so "Created: 6 months ago" would drift by one
 * word every month and fail baselines that nothing had touched.
 */
export const FIXED_NOW = new Date('2026-07-01T12:00:00Z');

/** Hide anything whose content varies run to run. */
export async function stabilise(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; }
      .cm-cursor, .cm-dropCursor { visibility: hidden !important; }
      /*
       * Measured durations, listed one by one. A substring match on
       * [class*="duration"] used to stand in for this list, and it also
       * matched Tailwind's duration-200 utility on the shadcn dialog shell —
       * so every dialog baseline was a screenshot of a dimmed page with no
       * dialog in it, and passed.
       */
      .col-timing, .duration, .duration-total, .etl-timing-donut,
      .timing-cell, .timing-donut, .timing-inline, .timing-raw, .timing-tooltip,
      .executed-time-container { visibility: hidden !important; }
      /* Toasts appear and expire on their own schedule. */
      [data-sonner-toaster] { display: none !important; }
    `,
  });
  /*
   * Wait for webfonts before the settle delay. Inter loads asynchronously, and
   * anything laid out with the fallback metrics and then reflowed lands on
   * slightly different column widths — enough for an auto-layout table to
   * resolve a boundary one pixel either way, run to run. That showed up as a
   * 3102-pixel diff on the rule set execution shot that reproduced on roughly
   * half of runs and was not a visual change at all.
   */
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}
