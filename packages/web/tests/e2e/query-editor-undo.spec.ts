import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';

/**
 * Undo, after switching to another query.
 *
 * One CodeMirror serves the whole Queries section — picking another query
 * hands new text to the instance the last one was written in. CodeMirror has
 * no idea the document changed, so the swap was one more entry in the same
 * undo history: Ctrl-Z brought the *previous* query's text back onto the
 * screen, and the autosave behind it wrote that text into the query that was
 * actually selected. This spec is that sequence, end to end.
 */

const LIBRARY = {
  id: 'urn:sqlib:library:undo-1',
  name: 'Undo Library',
  description: 'Two queries, one editor',
  defaultBackend: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const QUERY_A_BODY = 'SELECT ?alpha WHERE { ?alpha a <urn:A> }';
const QUERY_B_BODY = 'SELECT ?beta WHERE { ?beta a <urn:B> }';

type Fixture = {
  id: string;
  name: string;
  versionId: string;
  body: string;
};

const QUERY_A: Fixture = {
  id: 'urn:sqlib:query:undo-a',
  name: 'Alpha Query',
  versionId: 'urn:sqlib:query-version:undo-a-1',
  body: QUERY_A_BODY,
};

const QUERY_B: Fixture = {
  id: 'urn:sqlib:query:undo-b',
  name: 'Beta Query',
  versionId: 'urn:sqlib:query-version:undo-b-1',
  body: QUERY_B_BODY,
};

const entity = (fixture: Fixture) => ({
  id: fixture.id,
  name: fixture.name,
  description: null,
  defaultBackend: null,
  isPartOf: [LIBRARY.id],
  currentVersion: fixture.versionId,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
});

const version = (fixture: Fixture) => ({
  id: fixture.versionId,
  version: 1,
  queryString: fixture.body,
  comment: 'Original version',
  isPartOf: fixture.id,
  queryType: null,
  defaultBackend: null,
  limitParameters: null,
  offsetParameters: null,
  inferredInputs: null,
  inferredOutputs: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
});

const expanded = (fixture: Fixture) => ({
  queryVersion: version(fixture),
  limitParameters: [],
  offsetParameters: [],
  inputs: [],
  outputs: [],
  inputTuples: [],
  outputTuples: [],
  tupleMembers: [],
});

const json = (route: Route, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  });

async function mockQuery(page: Page, fixture: Fixture) {
  const encoded = encodeURIComponent(fixture.id);
  await page.route(`**//localhost:3000/queries/${encoded}`, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await json(route, entity(fixture), { ETag: `"etag-${fixture.id}"` });
  });
  await page.route(`**//localhost:3000/queries/${encoded}/v`, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await json(route, [version(fixture)]);
  });
  await page.route(`**//localhost:3000/queries/${encoded}/v/*`, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await json(route, expanded(fixture), { ETag: `"etag-${fixture.versionId}"` });
  });
}

const editor = (page: Page) => page.locator('.query-work-area .cm-content').first();

/** The row in the Queries sidebar, which is how a query is switched to. */
const row = (page: Page, fixture: Fixture) =>
  page.locator(`[data-testid="entity-list-sidebar"] [data-entity-id="${fixture.id}"]`);

/*
 * Opened with the section as well as the query: switching queries needs the
 * list to switch from, and `?query=` alone leaves the app unscoped, which is
 * the splash and no sidebar at all.
 */
async function openQuery(page: Page, fixture: Fixture) {
  await page.goto(`/?section=queries&query=${encodeURIComponent(fixture.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.query-work-area');
  await expect(editor(page)).toContainText(fixture.body.slice(0, 20));
}

test.describe('Query editor undo', () => {
  test.beforeEach(async ({ page }) => {
    await mockSidebarCollections(page, {
      libraries: [LIBRARY],
      queries: [entity(QUERY_A), entity(QUERY_B)],
    });
    await mockQuery(page, QUERY_A);
    await mockQuery(page, QUERY_B);
  });

  test('undo after switching queries never reaches the query before it', async ({ page }) => {
    await openQuery(page, QUERY_A);

    // Something to undo, in the query that is about to be left behind.
    await editor(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' # alpha edit');
    await expect(editor(page)).toContainText('# alpha edit');

    await row(page, QUERY_B).click();
    await expect(editor(page)).toContainText('?beta');

    // Three, because one press was never the point: the history either belongs
    // to this document or it does not.
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');

    await expect(editor(page)).toContainText('?beta');
    await expect(editor(page)).not.toContainText('?alpha');
    await expect(editor(page)).not.toContainText('# alpha edit');
  });

  test('still undoes an edit made to the query on screen', async ({ page }) => {
    await openQuery(page, QUERY_A);

    await row(page, QUERY_B).click();
    await expect(editor(page)).toContainText('?beta');

    await editor(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' # beta edit');
    await expect(editor(page)).toContainText('# beta edit');

    await page.keyboard.press('ControlOrMeta+z');

    await expect(editor(page)).not.toContainText('# beta edit');
    await expect(editor(page)).toContainText('?beta');
  });
});
