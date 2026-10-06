import { test, expect, type Page, type Route } from '@playwright/test';
import { mockEntityApi, LIBRARY, RULE_SET } from './fixtures/entities';
import { recordUrl, sectionUrl } from './navigate';

/**
 * A link to a record opens it in the record's own library.
 *
 * The record's id is a global IRI and the record names its library in
 * `isPartOf`, so the path alone says which library it is in. Before this the
 * active library was whatever this browser last had open: a shared link to a
 * rule set opened it beside another library's list, and Save on it targeted
 * that other library.
 */

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const ACTIVE_LIBRARY_KEY = 'sparql-query-lib-active-library';

const OTHER_LIBRARY = {
  ...LIBRARY,
  id: 'urn:sqlib:library:other',
  name: 'Other Library',
};

async function setUp(page: Page, storedLibrary: string) {
  await mockEntityApi(page, {
    extraRoutes: [[/\/libraries$/, (route) => json(route, [OTHER_LIBRARY, LIBRARY])]],
  });
  await page.addInitScript(
    ([key, id]) => {
      // Once per document, so a test can read what the page wrote back.
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key as string, id as string);
        sessionStorage.setItem('seeded', '1');
      }
    },
    [ACTIVE_LIBRARY_KEY, storedLibrary],
  );
}

const switcher = (page: Page) => page.locator('[data-testid="library-switcher"]');

test('a record link switches the active library to the record\'s own', async ({ page }) => {
  await setUp(page, OTHER_LIBRARY.id);

  await page.goto(`/rules/${encodeURIComponent(RULE_SET.id)}`, { waitUntil: 'domcontentloaded' });

  await expect(switcher(page)).toHaveAttribute('aria-label', `Library — ${LIBRARY.name}`);
  await expect(page.locator(`[data-entity-id="${RULE_SET.id}"]`)).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_LIBRARY_KEY)).toBe(LIBRARY.id);
});

test('a record link ignores a ?library= that contradicts the record', async ({ page }) => {
  await setUp(page, LIBRARY.id);

  await page.goto(
    `/rules/${encodeURIComponent(RULE_SET.id)}?library=${encodeURIComponent(OTHER_LIBRARY.id)}`,
    { waitUntil: 'domcontentloaded' },
  );

  await expect(switcher(page)).toHaveAttribute('aria-label', `Library — ${LIBRARY.name}`);
  await expect(page).toHaveURL(recordUrl('rules', RULE_SET.id));
  expect(new URL(page.url()).searchParams.get('library')).toBeNull();
});

test('a list link opens the library it names', async ({ page }) => {
  await setUp(page, LIBRARY.id);

  await page.goto(`/tests?library=${encodeURIComponent(OTHER_LIBRARY.id)}`, { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(sectionUrl('tests'));
  await expect(switcher(page)).toHaveAttribute('aria-label', `Library — ${OTHER_LIBRARY.name}`);
});
