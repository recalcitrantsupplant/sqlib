import { test, expect, type Page } from '@playwright/test';
import { mockEntityApi, LIBRARY, QUERY } from './fixtures/entities';

/**
 * Tags in the Queries sidebar — mockup 1a, end to end.
 *
 * The claim the option makes, and the one worth an e2e: grouping is a *view*
 * over the same list. A query in two tags appears under both headings, marked
 * with the other tag's colour, and untagged queries fall into a group the
 * client computes rather than one the server stores.
 */

const TAGS = [
  { id: 'urn:sqlib:tag:prod', name: 'Production', color: '#2f6feb', isPartOf: LIBRARY.id },
  { id: 'urn:sqlib:tag:geo', name: 'Geo', color: '#15803d', isPartOf: LIBRARY.id },
];

const TAGGED_QUERY = { ...QUERY, tags: [TAGS[0].id, TAGS[1].id] };

const UNTAGGED_QUERY = {
  id: 'urn:sqlib:query:untagged',
  name: 'Taxon rank hierarchy',
  description: 'Carries no tags at all — the normal state',
  currentVersion: 'urn:sqlib:query-version:aa11bb',
  currentVersionNumber: 3,
  isPartOf: [LIBRARY.id],
  tags: [],
  dateCreated: '2026-01-01T00:00:00Z',
  dateModified: '2026-01-02T00:00:00Z',
};

async function mockTaggedLibrary(page: Page) {
  await mockEntityApi(page, {
    extraRoutes: [
      [/\/tags$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TAGS) });
      }],
      [/\/queries$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([TAGGED_QUERY, UNTAGGED_QUERY]),
        });
      }],
    ],
  });
}

async function openQueries(page: Page) {
  await page.goto('/?section=queries', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="entity-list-sidebar"]');
}

test.describe('Grouping the sidebar by tag', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('sparql-query-lib-scratch-migrated', 'true');
    });
    await mockTaggedLibrary(page);
  });

  test('files a query under each of its tags, with the others as dots', async ({ page }) => {
    await openQueries(page);

    // Flat until asked otherwise.
    await expect(page.locator('[data-testid="saved-row"]')).toHaveCount(2);

    await page.locator('[data-testid="group-by"]').click();
    await page.locator('[data-testid="group-by-tag"]').click();

    await expect(page.locator('[data-testid="tag-group-urn:sqlib:tag:prod"]')).toBeVisible();
    await expect(page.locator('[data-testid="tag-group-urn:sqlib:tag:geo"]')).toBeVisible();

    // The tagged query is listed under both tags; the untagged one once, under
    // the computed group.
    const rows = page.locator('[data-testid="saved-row"]');
    await expect(rows.filter({ hasText: QUERY.name })).toHaveCount(2);
    await expect(rows.filter({ hasText: UNTAGGED_QUERY.name })).toHaveCount(1);
    await expect(page.locator('.group-name', { hasText: 'Untagged' })).toBeVisible();

    // Whichever heading a copy sits under, its dot names the *other* tag and
    // never repeats the group's own — the store lists tags by name, so Geo
    // comes first and Production second.
    const copies = rows.filter({ hasText: QUERY.name });
    await expect(copies.nth(0).locator('[data-testid="other-tag-dots"]')).toHaveAttribute('title', 'Also in Production');
    await expect(copies.nth(1).locator('[data-testid="other-tag-dots"]')).toHaveAttribute('title', 'Also in Geo');
    await expect(copies.nth(0).locator('[data-testid="other-tag-dots"] [data-testid="tag-dot"]')).toHaveCount(1);
  });

  test('collapses a group and keeps the choice across sections', async ({ page }) => {
    await openQueries(page);
    await page.locator('[data-testid="group-by"]').click();
    await page.locator('[data-testid="group-by-tag"]').click();

    await page.locator('[data-testid="tag-group-urn:sqlib:tag:geo"]').click();
    await expect(page.locator('[data-testid="saved-row"]').filter({ hasText: QUERY.name })).toHaveCount(1);

    // The grouping is a setting, so it survives a reload rather than resetting
    // to flat the moment you look away.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="entity-list-sidebar"]');
    await expect(page.locator('[data-testid="tag-group-urn:sqlib:tag:prod"]')).toBeVisible();
  });
});
