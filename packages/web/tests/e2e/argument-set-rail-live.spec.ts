import { test, expect, type Page, type Route } from '@playwright/test';
import { mockEntityApi, QUERY } from './fixtures/entities';

/**
 * A scratch argument set made on a query, seen in the rail, in one session.
 *
 * This is the loop the two-store split broke. The query screen wrote to
 * `sparql-query-lib-argument-set-drafts` and the rail read
 * `sparql-query-lib-callable-drafts`, so:
 *
 * 1. a set made on a query never reached the rail in that session;
 * 2. it appeared after a reload, because the legacy-key migration runs at
 *    module load — which made a missing write read as a caching glitch;
 * 3. a reload could eat edits, because the migration skips a legacy record
 *    whose id is already in the new store and then deletes the key.
 *
 * So the assertions are: no reload before the rail sees it, and the edits
 * made after a reload survive the next one.
 */

const DETECTED = {
  valuesInputs: [['city']],
  limitParameters: [],
  offsetParameters: [],
  correlatedExistsInputs: [],
};

const switcher = (page: Page) => page.locator('[data-testid="argument-set-switcher"]');
const state = (page: Page) => page.locator('[data-testid="argument-set-state"]');
const values = (page: Page) => page.locator('[data-testid="argument-value"]');
const scratchRows = (page: Page) => page.locator('[data-testid="scratch-row"]');

async function openQueryArguments(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.nav-sidebar');
  await page.locator('.library-toggle').first().click();
  await page.locator('.category-header').filter({ hasText: 'Queries' }).first().click();
  await page.locator('.item-button').filter({ hasText: QUERY.name }).first().click();
  await expect(page.locator('.query-work-area')).toBeVisible();
  await page.locator('[data-testid="arguments-tab"]').click();
}

/** Pick the one scratch set out of the switcher's Scratch cluster. */
async function reopenScratchSet(page: Page) {
  await switcher(page).click();
  await page.locator('.set-menu .set-row').first().click();
  await expect(state(page)).toHaveText('Scratch');
}

/** The Argument sets rail, reached the way a person reaches it. */
async function openArgumentSetsRail(page: Page) {
  await page.locator('.nav-rail .rail-button').filter({ hasText: 'Argument sets' }).first().click();
  await page.waitForSelector('[data-testid="entity-list-sidebar"]');
}

test.describe('Argument sets made on a query reach the rail', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page, {
      extraRoutes: [
        [/\/detect-inputs$/, async (route: Route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(DETECTED),
          });
        }],
      ],
    });
    await openQueryArguments(page);
  });

  test('a scratch set is in the rail without a reload, and its edits survive one', async ({ page }) => {
    await switcher(page).click();
    await page.locator('[data-testid="argument-new-scratch"]').click();
    await expect(state(page)).toHaveText('Scratch');

    await page.locator('[data-testid="argument-add-row"]').click();
    await values(page).first().fill('http://example.org/perth');
    // Past the autosave debounce, so the record exists before the rail is asked.
    await page.waitForTimeout(700);

    // The whole point: no reload between the write and the read.
    await openArgumentSetsRail(page);
    await expect(scratchRows(page)).toHaveCount(1);

    // Back on the query, keep editing the same set, then reload twice. The
    // second reload is what used to eat the edits: the first migrated the
    // record, the edits went back to the legacy key, and the second dropped
    // them as a duplicate id.
    await openQueryArguments(page);
    // Reopening the query opens no set; the scratch one is where the switcher
    // says it is, which is itself part of what this is checking.
    await reopenScratchSet(page);
    await values(page).first().fill('http://example.org/hobart');
    await page.waitForTimeout(700);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.nav-sidebar');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.nav-sidebar');

    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('sparql-query-lib-callable-drafts') ?? '[]')
        .filter((entry: { section?: string }) => entry.section === 'argumentSet'),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].kind).toBe('scratch');
    expect(stored[0].body.tupleBindings[0].rows[0].values.city.value).toBe('http://example.org/hobart');

    await openArgumentSetsRail(page);
    await expect(scratchRows(page)).toHaveCount(1);
  });
});
