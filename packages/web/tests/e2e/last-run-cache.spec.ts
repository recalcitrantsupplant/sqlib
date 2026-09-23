/**
 * The last run stays on screen across a visit to something else.
 *
 * A result lived only in the work area, so opening another record and coming
 * back lost it — the rows had to be fetched again to be read again. One run
 * per record is kept in the browser, the way an unsaved body is, and is
 * replaced by the next run of that record.
 */
import { test, expect, type Page } from '@playwright/test';
import { mockEntityApi, QUERY, LIBRARY } from './fixtures/entities';

const SECOND_QUERY = {
  ...QUERY,
  id: 'urn:sqlib:query:second',
  name: 'Second query',
  currentVersion: null,
  currentVersionNumber: null,
};

async function bootstrap(page: Page) {
  await mockEntityApi(page, {
    extraRoutes: [
      [/\/queries$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([QUERY, SECOND_QUERY]),
      })],
    ],
  });
  await page.goto(`/?section=queries&library=${encodeURIComponent(LIBRARY.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('.entity-name', { hasText: QUERY.name }).first()).toBeVisible();
}

const row = (page: Page, name: string) => page.locator('.entity-name', { hasText: name }).first();

test('keeps the last run when you come back to the query', async ({ page }) => {
  await bootstrap(page);

  await row(page, QUERY.name).click();
  await page.locator('[data-testid="run-bar-run"]').click();
  await expect(page.locator('.viewer-content-area')).toContainText('1411778724');

  // Away to another record, then back.
  await row(page, SECOND_QUERY.name).click();
  await expect(page.locator('.viewer-content-area')).toHaveCount(0);
  await row(page, QUERY.name).click();

  await expect(page.locator('.viewer-content-area')).toContainText('1411778724');
});

test('keeps it across a reload, and only for the query that ran', async ({ page }) => {
  await bootstrap(page);

  await row(page, QUERY.name).click();
  await page.locator('[data-testid="run-bar-run"]').click();
  await expect(page.locator('.viewer-content-area')).toContainText('1411778724');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.viewer-content-area')).toContainText('1411778724');

  await row(page, SECOND_QUERY.name).click();
  await expect(page.locator('.viewer-content-area')).toHaveCount(0);
});
