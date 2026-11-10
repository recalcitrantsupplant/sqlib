/**
 * The count on the Tests tab of the Tests section.
 *
 * `GET /tests` returns the tests of every library, and the list under the tab
 * shows the current library's. The tab counted the whole listing, so a
 * library with four tests showed `Tests 267`. The count must equal the list
 * header's count: the library's saved tests plus its scratch tests.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { createMockState, setupMockApi } from './query-group-test-helpers';
import { EXISTING_QUERY_ID, LIBRARY_ID } from './fixtures/query-group-mock-state';
import { API_ORIGIN } from './api-origin';

const OTHER_LIBRARY_ID = 'urn:sqlib:library:another';

/** A test as `GET /tests` sends it; the client parses the listing `.strict()`. */
function storedTest(id: string, libraryId: string) {
  return {
    id,
    name: id.split(':').pop(),
    description: null,
    subject: EXISTING_QUERY_ID,
    subjectKind: 'query',
    criterion: null,
    currentVersion: `${id}:v1`,
    currentVersionNumber: 1,
    isPartOf: [libraryId],
    tags: [],
    dateCreated: '2026-01-01T00:00:00.000Z',
    dateModified: '2026-01-01T00:00:00.000Z',
  };
}

const TESTS = [
  storedTest('urn:sqlib:test:here-1', LIBRARY_ID),
  storedTest('urn:sqlib:test:here-2', LIBRARY_ID),
  storedTest('urn:sqlib:test:there-1', OTHER_LIBRARY_ID),
  storedTest('urn:sqlib:test:there-2', OTHER_LIBRARY_ID),
  storedTest('urn:sqlib:test:there-3', OTHER_LIBRARY_ID),
];

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function openTestsSection(page: Page) {
  await setupMockApi(page, createMockState());
  // Registered after the helper, so it wins: Playwright tries the newest handler first.
  await page.route(`${API_ORIGIN}/tests*`, (route: Route) =>
    route.request().method() === 'GET' ? json(route, TESTS) : route.fallback());
  await page.route(`${API_ORIGIN}/tests/*/versions*`, (route: Route) => json(route, []));
  await page.goto(`/?section=tests&library=${encodeURIComponent(LIBRARY_ID)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="entity-list-sidebar"]');
}

const tabCount = (page: Page) => page.getByTestId('tests-tab-tests').locator('.tab-count');

test.describe('Tests tab count', () => {
  test('counts the current library’s tests only', async ({ page }) => {
    await openTestsSection(page);

    await expect(page.locator('[data-entity-id^="urn:sqlib:test:here-"]')).toHaveCount(2);
    await expect(page.locator('[data-entity-id^="urn:sqlib:test:there-"]')).toHaveCount(0);
    await expect(tabCount(page)).toHaveText('2');
  });

  test('counts a scratch test with the saved ones', async ({ page }) => {
    await openTestsSection(page);
    await expect(tabCount(page)).toHaveText('2');

    await page.getByTestId('new-scratch').click();
    await expect(tabCount(page)).toHaveText('3');
  });
});
