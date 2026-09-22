import { test, expect, type Page } from '@playwright/test';
import { mockEntityApi, QUERY, QUERY_GROUP, RULE_SET } from './fixtures/entities';
import { openCreateLibraryDialog, openSavedEntity, openSection, openSplash } from './navigate';
import { mockCallableLibrary, seedDraft } from './fixtures/callables';
import { FIXED_NOW, setTheme, stabilise } from './visual-helpers';

/**
 * Visual regression baselines for the design system.
 *
 * These exist because the design system rollout changes markup across many
 * components at once, and neither the build, the unit tests, nor stylelint can
 * tell you that a panel header lost its padding. Screenshot diffs can.
 *
 * RUN AGAINST THE PRODUCTION PREVIEW, NOT THE DEV SERVER:
 *
 *     pnpm build && pnpm preview &
 *     npx playwright test visual-regression
 *
 * The dev server re-optimises Vite dependencies the first time a page pulls in
 * new imports, which invalidates the module graph mid-run and serves a 500 for
 * dynamically imported pages. The preview build has no on-demand compilation
 * and is deterministic.
 *
 * Add `--update-snapshots` to re-baseline after an intentional visual change,
 * and review the diff images it writes before committing them.
 *
 * All API traffic is answered from `fixtures/entities.ts`, so the screenshots
 * do not depend on backend state. The fixtures are populated on purpose: an
 * earlier version of this suite mocked every collection as empty, which meant
 * the editors, the canvas and the dialogs were never rendered — and a badge
 * restyle could pass every baseline without a single badge on screen.
 */

/*
 * `setTheme`, `FIXED_NOW` and `stabilise` moved to `visual-helpers.ts` when the
 * canvas states got a spec of their own (#47 item 5). They are imported rather
 * than copied: a second stabilisation list is a second answer to "why did this
 * baseline flake", and the flakes they fix were expensive to find once.
 */

/** Land on the app: `/` is the splash screen. */
async function openApp(page: Page) {
  await openSplash(page);
}

/**
 * A section's sidebar and the entity picked in it. The sidebar is the only
 * route into the work areas, so every editor shot starts here.
 */
async function selectSidebarItem(page: Page, section: string, entityId: string) {
  await openSavedEntity(page, section, entityId);
}

for (const theme of ['light', 'dark'] as const) {
  /*
   * Tagged @visual so CI can exclude it: the baselines are rendered with this
   * machine's font stack, and a GitHub runner rasterises text differently, so
   * these would fail there for reasons that have nothing to do with the diff.
   */
  test.describe(`visual — ${theme}`, { tag: '@visual' }, () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(FIXED_NOW);
      await setTheme(page, theme);
      await mockEntityApi(page);
      await page.setViewportSize({ width: 1600, height: 950 });
    });

    // --- Playgrounds and chrome ------------------------------------------

    // Was `sparql playground`. That screen is gone; the Queries section with a
    // scratch query is what replaced it, and it is what is worth baselining.
    test(`queries section`, async ({ page }) => {
      await page.goto('/?section=queries', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="entity-list-sidebar"]');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`queries-section-${theme}.png`, { fullPage: false });
    });

    // Both playgrounds are sections now, reached the same way Queries is —
    // through the rail, with the unsaved item selected in the sidebar rather
    // than through a tree entry of their own.
    test(`rules section`, async ({ page }) => {
      await page.goto('/?section=rules', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="entity-list-sidebar"]');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`rules-section-${theme}.png`, { fullPage: false });
    });

    test(`etl section`, async ({ page }) => {
      await page.goto('/?section=etl', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="entity-list-sidebar"]');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`etl-section-${theme}.png`, { fullPage: false });
    });

    test(`bench section`, async ({ page }) => {
      await page.goto('/?section=benchmarks', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="entity-list-sidebar"]');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`bench-section-${theme}.png`, { fullPage: false });
    });

    test(`settings dialog`, async ({ page }) => {
      await openApp(page);
      // Settings moved from the sidebar footer to the nav rail, and the rail's
      // button is icon-only — there is no "Settings" text to click any more.
      await page.locator('.nav-rail .rail-icon-button[aria-label="Settings"]').click();
      await stabilise(page);
      await expect(page).toHaveScreenshot(`settings-${theme}.png`, { fullPage: false });
    });

    /*
     * The splash replaced the artifact tree, so the two tree shots — the
     * library row expanded, and the sidebar around it — became one shot of
     * what `/` draws now: the sections and the libraries.
     */
    test(`splash`, async ({ page }) => {
      await openApp(page);
      await stabilise(page);
      await expect(page).toHaveScreenshot(`splash-${theme}.png`, { fullPage: false });
    });

    /*
     * Empty collections still need a baseline of their own. The populated
     * fixtures cover the editors, but they hide every "No queries yet" style
     * empty state, and those are a design-system surface in their own right.
     */
    test(`sidebar — empty collection`, async ({ page }) => {
      await mockEntityApi(page, {
        extraRoutes: [
          [
            /\/(queries|query-groups|rules|rule-sets|data-blocks)$/,
            (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
          ],
        ],
      });
      await openSection(page, 'queries');
      await stabilise(page);
      await expect(page.locator('[data-testid="entity-list-sidebar"]')).toHaveScreenshot(
        `sidebar-empty-${theme}.png`,
      );
    });

    // --- Editors ----------------------------------------------------------

    test(`query editor`, async ({ page }) => {
      await selectSidebarItem(page, 'queries', QUERY.id);
      await expect(page.locator('.query-work-area')).toBeVisible();
      await stabilise(page);
      await expect(page).toHaveScreenshot(`query-editor-${theme}.png`, { fullPage: false });
    });

    test(`rule set editor`, async ({ page }) => {
      await selectSidebarItem(page, 'rules', RULE_SET.id);
      await expect(page.locator('.ruleset-work-area')).toBeVisible();
      await stabilise(page);
      await expect(page).toHaveScreenshot(`ruleset-editor-${theme}.png`, { fullPage: false });
    });

    /*
     * Fixme, and it was already broken: it clicked `getByTitle('Execute Rule
     * Set')`, a title the rules screen has not had for some time, so the shot
     * has not been taken in a while. Driving the run bar instead gets further
     * and then stops — against the mocked API the editor fills but the work
     * area's own `srlDocument` stays empty, so Run refuses the document on
     * screen. That is a fixture or component question rather than a visual
     * one, and it is not this change's to answer; the baselines are kept so
     * the shot comes back rather than being re-invented.
     */
    test.fixme(`rule set execution results`, async ({ page }) => {
      await selectSidebarItem(page, 'rules', RULE_SET.id);
      await expect(page.locator('.ruleset-work-area')).toBeVisible();
      // The run bar, which replaced the titled Execute button this used to
      // click — the title had been gone long enough for the shot to be stale.
      // Run refuses an empty document, so wait for the SRL to arrive first.
      await expect(page.locator('.ruleset-work-area .cm-content').first()).toContainText('RULE');
      await page.locator('[data-testid="run-bar-run"]').click();
      await expect(page.locator('.results-container')).toBeVisible();
      /*
       * The container is visible before the inference graph has anything in
       * it: the N-Triples are parsed after mount, and the table's column
       * widths are only settled once its rows exist. Waiting on the rows
       * rather than on `stabilise`'s fixed delay is what makes this shot
       * deterministic on a cold first run.
       */
      await expect(page.locator('.final-graph-content tbody tr')).toHaveCount(3);
      await stabilise(page);
      /*
       * The inference graph is an auto-layout table, so its column widths are
       * resolved from measured text. At this panel width one boundary lands
       * within a pixel of a rounding step and settles either side of it run to
       * run, moving a column divider by 1px and re-rasterising the monospace
       * IRIs beside it: a stable 3102-pixel diff with no visual change in it.
       * Waiting on `document.fonts.ready` removed most of it; this budget
       * covers the rest. It is deliberately just above the observed diff, so a
       * real regression in this shot — a colour, a size, a missing element —
       * still fails.
       */
      await expect(page).toHaveScreenshot(`ruleset-execution-${theme}.png`, {
        fullPage: false,
        maxDiffPixels: 3500,
      });
    });

    test(`query groups canvas`, async ({ page }) => {
      await selectSidebarItem(page, 'queryGroups', QUERY_GROUP.id);
      await expect(page.locator('.querygroup-work-area')).toBeVisible();
      await stabilise(page);
      await expect(page).toHaveScreenshot(`query-group-canvas-${theme}.png`, { fullPage: false });
    });

    test(`benchmarks`, async ({ page }) => {
      await openSection(page, 'benchmarks');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`benchmarks-${theme}.png`, { fullPage: false });
    });

    // --- Build screen -----------------------------------------------------

    /*
     * Its own fixtures rather than the shared ones: the shared query's
     * expanded version has empty inputs and outputs, so a baseline taken with
     * it would be a screenshot of a signature table rendering no signatures —
     * the same blind spot the badge pass hit.
     */
    test(`build — callable library`, async ({ page }) => {
      await mockCallableLibrary(page);
      await seedDraft(page);
      await page.goto('/build', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.callable-row');
      await stabilise(page);
      await expect(page).toHaveScreenshot(`build-library-${theme}.png`, { fullPage: false });
    });

    test(`build — expanded signatures`, async ({ page }) => {
      await mockCallableLibrary(page);
      await page.goto('/build', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.callable-row');
      await page.getByRole('button', { name: 'Expand all signatures' }).click();
      await stabilise(page);
      await expect(page).toHaveScreenshot(`build-stacked-${theme}.png`, { fullPage: false });
    });

    test(`build — expanded row`, async ({ page }) => {
      await mockCallableLibrary(page);
      await page.goto('/build', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.callable-row');
      await page.locator('.callable-row').filter({ hasText: 'Product search' }).getByTitle('Code').click();
      await expect(page.locator('.snippet')).toBeVisible();
      await stabilise(page);
      await expect(page).toHaveScreenshot(`build-detail-${theme}.png`, { fullPage: false });
    });

    // --- Dialogs ----------------------------------------------------------

    /*
     * Dialogs share a shell but each builds its own form, so they drift
     * independently. One shot per dialog rather than one representative.
     */
    test(`dialog — add library`, async ({ page }) => {
      await openApp(page);
      await openCreateLibraryDialog(page);
      await stabilise(page);
      await expect(page).toHaveScreenshot(`dialog-add-library-${theme}.png`, { fullPage: false });
    });

    /*
     * The Add Query, Add Query Group and Add Rule Set shots went with their
     * dialogs. Those were the artifact tree's creation path; a section makes
     * an unsaved item in its own list instead, which the section shots above
     * already show.
     */

    // --- Static galleries -------------------------------------------------

    /*
     * They need no fixtures and render a lot of chrome — headers, toolbars,
     * buttons, labels, empty states — in one shot.
     */
    for (const [name, route] of [
      ['query-details-wireframe', '/wireframe-query-details-compact'],
      ['button-variants-wireframe', '/wireframe-add-button-variants'],
      ['rule-viewer-mockups', '/tests/rule-viewer-mockups'],
    ] as const) {
      test(`gallery — ${name}`, async ({ page }) => {
        await page.goto(route);
        await stabilise(page);
        await expect(page).toHaveScreenshot(`${name}-${theme}.png`, { fullPage: true });
      });
    }
  });
}
