import { test, expect, type Page } from '@playwright/test';
import { mockEntityApi, LIBRARY, QUERY } from './fixtures/entities';

/**
 * The Queries sidebar: a flat list with a pinned scratch cluster, replacing
 * the artifact tree for this one section.
 *
 * The claims under test are the ones the nav doc makes and the tree could not
 * make: that an unsaved query is an item in the list rather than a separate
 * screen, that it survives being switched away from, and that discarding it is
 * the only way it goes away.
 */

const DRAFTS_KEY = 'sparql-query-lib-callable-drafts';
const PLAYGROUND_TABS_KEY = 'playground.queries.v2.tabs';
const MIGRATION_KEY = 'sparql-query-lib-scratch-migrated';

const SECOND_QUERY = {
  id: 'urn:sqlib:query:labels',
  name: 'Dataset labels',
  description: 'A second fixture query, for filtering',
  defaultBackend: QUERY.defaultBackend,
  // A real version IRI: a uuid, with no number in it. The badge reads
  // `currentVersionNumber`, which the server projects from the version.
  currentVersion: 'urn:sqlib:query-version:9f2c1a',
  currentVersionNumber: 7,
  isPartOf: [LIBRARY.id],
  dateCreated: '2026-01-01T00:00:00Z',
  dateModified: '2026-01-02T00:00:00Z',
};

/** Two queries in the library, so filtering has something to filter. */
async function mockTwoQueries(page: Page) {
  await mockEntityApi(page, {
    extraRoutes: [
      [/\/queries$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([QUERY, SECOND_QUERY]),
        });
      }],
    ],
  });
}

function scratchRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'urn:ui-temp:seeded-1',
    libraryId: 'unassigned',
    type: 'query',
    kind: 'scratch',
    section: 'query',
    name: 'label coverage check',
    description: null,
    queryString: 'SELECT * WHERE { ?s ?p ?o }',
    body: 'SELECT * WHERE { ?s ?p ?o }',
    resultKind: 'BINDINGS',
    inputTuples: [],
    limitParameters: [],
    offsetParameters: [],
    outputs: [],
    basedOn: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

async function seedStorage(page: Page, entries: Record<string, string>) {
  await page.addInitScript((seed: Record<string, string>) => {
    for (const [key, value] of Object.entries(seed)) {
      window.localStorage.setItem(key, value);
    }
  }, entries);
}

async function openQueries(page: Page) {
  await page.goto('/?section=queries', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="entity-list-sidebar"]');
}

const sidebar = (page: Page) => page.locator('[data-testid="entity-list-sidebar"]');
const savedRows = (page: Page) => page.locator('[data-testid="saved-row"]');
const scratchRows = (page: Page) => page.locator('[data-testid="scratch-row"]');

test.describe('Queries sidebar', () => {
  test.beforeEach(async ({ page }) => {
    // The migration marker is set so a stray playground tab from another spec
    // cannot leak a scratch row into these counts.
    await seedStorage(page, { [MIGRATION_KEY]: '2026-08-06T00:00:00Z' });
    await mockTwoQueries(page);
  });

  test('replaces the tree, and the section it switches to keeps the list', async ({ page }) => {
    await openQueries(page);
    await expect(sidebar(page)).toBeVisible();
    await expect(page.locator('.nav-sidebar')).toHaveCount(0);

    /*
     * Rules used to bring the tree back, because it was the last section on it.
     * All five are on the flat list now, so the sidebar stays and only what it
     * lists changes — which is the point of one component per five sections.
     */
    await page.locator('.nav-rail .rail-button').filter({ hasText: 'Rules' }).click();
    await expect(sidebar(page)).toBeVisible();
    await expect(page.locator('.section-name')).toHaveText('Rules');
    await expect(page.locator('.nav-sidebar')).toHaveCount(0);
  });

  test('lists the library’s saved queries with their current version', async ({ page }) => {
    await openQueries(page);
    await expect(savedRows(page)).toHaveCount(2);
    await expect(savedRows(page).filter({ hasText: 'Dataset labels' })).toContainText('v7');
  });

  test('counts saved and scratch together', async ({ page }) => {
    await seedStorage(page, { [DRAFTS_KEY]: JSON.stringify([scratchRecord()]) });
    await openQueries(page);

    await expect(scratchRows(page)).toHaveCount(1);
    await expect(savedRows(page)).toHaveCount(2);
    await expect(page.locator('[data-testid="section-count"]')).toHaveText('3');
  });

  test('+ New opens an untitled scratch query with no dialog', async ({ page }) => {
    await openQueries(page);
    await page.locator('[data-testid="new-scratch"]').click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(scratchRows(page)).toHaveCount(1);
    await expect(scratchRows(page).first()).toContainText('Untitled query 1');
    // Selected, and the URL says which one — a scratch item is addressable.
    await expect(scratchRows(page).first()).toHaveClass(/selected/);
    await expect(page).toHaveURL(/scratch=urn%3Aui-temp%3A|scratch=urn:ui-temp:/);
  });

  test('allocates the next free ordinal rather than reusing a discarded one', async ({ page }) => {
    await openQueries(page);
    await page.locator('[data-testid="new-scratch"]').click();
    await page.locator('[data-testid="new-scratch"]').click();
    await expect(scratchRows(page)).toHaveCount(2);

    // Discard "Untitled query 1"; the next one must not become a second 2.
    await scratchRows(page).filter({ hasText: 'Untitled query 1' })
      .locator('[data-testid="discard-scratch"]').click();
    await expect(scratchRows(page)).toHaveCount(1);

    await page.locator('[data-testid="new-scratch"]').click();
    await expect(scratchRows(page).filter({ hasText: 'Untitled query 3' })).toHaveCount(1);
  });

  test('filters across both clusters and hides a cluster with no matches', async ({ page }) => {
    await seedStorage(page, { [DRAFTS_KEY]: JSON.stringify([scratchRecord()]) });
    await openQueries(page);

    await page.locator('[data-testid="entity-filter"]').fill('labels');
    await expect(savedRows(page)).toHaveCount(1);
    await expect(scratchRows(page)).toHaveCount(0);

    await page.locator('[data-testid="entity-filter"]').fill('coverage');
    await expect(scratchRows(page)).toHaveCount(1);
    await expect(savedRows(page)).toHaveCount(0);
  });

  test('discards an empty scratch item silently and confirms one with a body', async ({ page }) => {
    await seedStorage(page, { [DRAFTS_KEY]: JSON.stringify([scratchRecord()]) });
    await openQueries(page);

    // Empty: no dialog, gone on the click.
    await page.locator('[data-testid="new-scratch"]').click();
    await expect(scratchRows(page)).toHaveCount(2);
    await scratchRows(page).filter({ hasText: 'Untitled query 1' })
      .locator('[data-testid="discard-scratch"]').click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(scratchRows(page)).toHaveCount(1);

    // Has a body: asked about, and cancelling keeps it.
    await scratchRows(page).first().locator('[data-testid="discard-scratch"]').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(scratchRows(page)).toHaveCount(1);

    await scratchRows(page).first().locator('[data-testid="discard-scratch"]').click();
    await page.locator('[data-testid="confirm-discard-scratch"]').click();
    await expect(scratchRows(page)).toHaveCount(0);
  });

  test('a scratch item survives switching to a saved query and back', async ({ page }) => {
    await openQueries(page);
    await page.locator('[data-testid="new-scratch"]').click();
    const scratchId = await scratchRows(page).first().getAttribute('data-scratch-id');

    await savedRows(page).first().click();
    await expect(page).toHaveURL(new RegExp(`query=${QUERY.id}`));
    await expect(scratchRows(page)).toHaveCount(1);

    // The list *is* the tab strip; switching back is one click, not a reload.
    await scratchRows(page).first().click();
    await expect(page).toHaveURL(new RegExp(`scratch=${scratchId!}`));
    await expect(scratchRows(page).first()).toHaveClass(/selected/);
  });

  test('round-trips a scratch selection through the URL', async ({ page }) => {
    await seedStorage(page, { [DRAFTS_KEY]: JSON.stringify([scratchRecord()]) });
    await page.goto(`/?section=queries&scratch=${encodeURIComponent('urn:ui-temp:seeded-1')}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('[data-testid="entity-list-sidebar"]');

    await expect(scratchRows(page).first()).toHaveClass(/selected/);
    // The body came back with it — the record, not just the selection.
    await expect(page.locator('.cm-content')).toContainText('SELECT * WHERE');
  });

  test('shows the amber dot for a query with an open draft in this browser', async ({ page }) => {
    const draft = scratchRecord({
      id: 'urn:ui-temp:edit-of-visual',
      kind: 'draft',
      libraryId: LIBRARY.id,
      name: 'Countries By Population',
      basedOn: QUERY.id,
    });
    await seedStorage(page, { [DRAFTS_KEY]: JSON.stringify([draft]) });
    await openQueries(page);

    const row = savedRows(page).filter({ hasText: 'Countries By Population' });
    await expect(row.locator('[data-testid="draft-dot"]')).toBeVisible();
    // Only the query it is based on wears it.
    await expect(savedRows(page).filter({ hasText: 'Dataset labels' })
      .locator('[data-testid="draft-dot"]')).toHaveCount(0);
  });

  test('brings the old playground tabs across as scratch items, once', async ({ page }) => {
    await seedStorage(page, {
      // No migration marker here: this is the first run after the upgrade.
      [PLAYGROUND_TABS_KEY]: JSON.stringify([
        { id: 'tab-1', name: 'wikidata poke', content: { query: 'SELECT ?s WHERE { ?s ?p ?o }' }, createdAt: 1754000000000, updatedAt: 1754000000000 },
        // The strip always kept one empty tab open; it is not worth a row.
        { id: 'tab-2', name: 'Untitled Query', content: { query: '   ' }, createdAt: 1754000000000, updatedAt: 1754000000000 },
      ]),
    });
    await page.addInitScript((key: string) => {
      window.localStorage.removeItem(key);
    }, MIGRATION_KEY);
    await openQueries(page);

    await expect(scratchRows(page)).toHaveCount(1);
    await expect(scratchRows(page).first()).toContainText('wikidata poke');

    // Idempotent: a reload must not double it, and the old key is left alone
    // so a rollback does not lose anyone's work.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="entity-list-sidebar"]');
    await expect(scratchRows(page)).toHaveCount(1);
    expect(await page.evaluate((key: string) => window.localStorage.getItem(key), PLAYGROUND_TABS_KEY)).not.toBeNull();
  });

  test('switching library changes the saved list and leaves scratch alone', async ({ page }) => {
    await seedStorage(page, { [DRAFTS_KEY]: JSON.stringify([scratchRecord()]) });
    await openQueries(page);
    await expect(scratchRows(page)).toHaveCount(1);
    await expect(savedRows(page)).toHaveCount(2);

    await page.locator('[data-testid="library-switcher"]').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem').first().click();

    // Scratch is not library-scoped — it reads `unassigned` until save —
    // so a library switch must not make an unsaved query disappear.
    await expect(scratchRows(page)).toHaveCount(1);
  });
});
