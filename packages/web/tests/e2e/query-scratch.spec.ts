import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';
import { API_HOST } from './api-origin';

/**
 * A query born scratch: written, run, named at the save moment, and turned
 * into v1 in the current library — without a dialog anywhere in the sequence.
 *
 * This is the flow that replaced the queries playground. The assertions worth
 * making are about what the playground could not do: the item is addressable,
 * it survives, and saving it is one click plus a name.
 */

const LIBRARY = {
  id: 'urn:sqlib:library:test-1',
  name: 'Test Library',
  description: 'A test library',
  defaultBackend: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

let createdQueries: any[] = [];
let createdVersions: any[] = [];
let failNextCreate = false;
let failNextVersion = false;

const scratchChip = (page: Page) => page.locator('[data-testid="scratch-chip"]');
const saveButton = (page: Page) => page.locator('[data-testid="save"]');
const detailsName = (page: Page) => page.locator('[data-testid="details-name"]');

/** The one place a name is edited: the Details tab. */
async function nameIt(page: Page, name: string) {
  await page.locator('[data-testid="details-tab"]').click();
  await detailsName(page).fill(name);
}
const scratchRows = (page: Page) => page.locator('[data-testid="scratch-row"]');
const savedRows = (page: Page) => page.locator('[data-testid="saved-row"]');

async function typeQuery(page: Page, text: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await expect(editor).toContainText(text.slice(0, 20));
  // Past the 500ms autosave debounce.
  await page.waitForTimeout(700);
}

test.describe('Scratch queries', () => {
  test.beforeEach(async ({ page }) => {
    createdQueries = [];
    createdVersions = [];
    failNextCreate = false;
    failNextVersion = false;

    await mockSidebarCollections(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('sparql-query-lib-scratch-migrated', '2026-08-06T00:00:00Z');
    });

    await page.route(`**//${API_HOST}/libraries`, async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([LIBRARY]) });
    });

    await page.route(`**//${API_HOST}/queries`, async (route: Route) => {
      if (route.request().method() === 'POST') {
        if (failNextCreate) {
          failNextCreate = false;
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Boom: the library refused this query' }),
          });
          return;
        }
        const body = route.request().postDataJSON();
        const created = {
          id: `urn:sqlib:query:created-${createdQueries.length + 1}`,
          name: body.name,
          description: body.description ?? null,
          defaultBackend: null,
          isPartOf: body.isPartOf,
          currentVersion: null,
          dateCreated: '2026-08-06T00:00:00Z',
          dateModified: '2026-08-06T00:00:00Z',
        };
        createdQueries.push(created);
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createdQueries) });
    });

    await page.route(`**//${API_HOST}/queries/*/v`, async (route: Route) => {
      if (route.request().method() === 'POST') {
        if (failNextVersion) {
          failNextVersion = false;
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Boom: the version was refused' }),
          });
          return;
        }
        const body = route.request().postDataJSON();
        const queryId = decodeURIComponent(route.request().url().split('/queries/')[1]!.replace('/v', ''));
        // Numbered from what this query already has: a hardcoded v1 made a
        // second save indistinguishable from the first, so the version pill
        // could never be seen to move.
        const nextVersion = createdVersions.filter((v) => v.isPartOf === queryId).length + 1;
        const version = {
          id: `${queryId}:v${nextVersion}`,
          version: nextVersion,
          queryString: body.queryVersion.queryString,
          comment: body.queryVersion.comment ?? null,
          isPartOf: queryId,
          queryType: null,
          defaultBackend: null,
          limitParameters: null,
          offsetParameters: null,
          inferredInputs: null,
          inferredOutputs: null,
          dateCreated: '2026-08-06T00:00:00Z',
          dateModified: '2026-08-06T00:00:00Z',
        };
        createdVersions.push(version);
        const target = createdQueries.find((query) => query.id === queryId);
        if (target) target.currentVersion = version.id;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          headers: { ETag: `"v${nextVersion}"` },
          body: JSON.stringify({
            queryVersion: version,
            limitParameters: [], offsetParameters: [], inputs: [], outputs: [],
            inputTuples: [], outputTuples: [], tupleMembers: [], iriMap: {},
          }),
        });
        return;
      }
      const queryId = decodeURIComponent(route.request().url().split('/queries/')[1]!.replace('/v', ''));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createdVersions.filter((v) => v.isPartOf === queryId)),
      });
    });

    await page.route(`**//${API_HOST}/queries/*/v/*`, async (route: Route) => {
      const version = createdVersions.at(-1);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          queryVersion: version,
          limitParameters: [], offsetParameters: [], inputs: [], outputs: [],
          inputTuples: [], outputTuples: [], tupleMembers: [],
        }),
      });
    });

    await page.route(`**//${API_HOST}/queries/*`, async (route: Route) => {
      const id = decodeURIComponent(route.request().url().split('/queries/')[1]!);
      const query = createdQueries.find((q) => q.id === id);
      if (!query) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ETag: '"q1"' },
        body: JSON.stringify(query),
      });
    });

    await page.goto('/?section=queries', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="entity-list-sidebar"]');
  });

  test('lands on a scratch query rather than a playground', async ({ page }) => {
    // An empty library and no unsaved work: an empty editor is a better first
    // screen than an empty list, and it is a real item, not a separate screen.
    await expect(scratchRows(page)).toHaveCount(1);
    await expect(scratchChip(page)).toBeVisible();
    await expect(page).toHaveURL(/scratch=/);
  });

  test('runs an unsaved body without saving it first', async ({ page }) => {
    let executed: string | null = null;
    await page.route(`**//${API_HOST}/sparql`, async (route: Route) => {
      executed = route.request().postDataJSON()?.query ?? null;
      await route.fulfill({
        status: 200,
        contentType: 'application/sparql-results+json',
        body: JSON.stringify({ head: { vars: ['s'] }, results: { bindings: [] } }),
      });
    });

    await typeQuery(page, 'SELECT ?s WHERE { ?s ?p ?o }');

    // Any backend will do; the ephemeral one needs nothing configured.
    await page.locator('[data-testid="run-bar-backend"]').click();
    await page.getByRole('option').filter({ hasText: /ephemeral/i }).first().click();
    await page.locator('[data-testid="run-bar-run"]').click();

    // Straight down the direct-execution path: a scratch query has no version
    // for an /execute call to point at, and never having to save something
    // just to try it is the whole reason the playground existed.
    await expect.poll(() => executed).toContain('SELECT ?s WHERE');
  });

  test('saves with the name from Details, and the item moves to Saved', async ({ page }) => {
    await typeQuery(page, 'SELECT ?country WHERE { ?country a ?type }');

    await expect(saveButton(page)).toContainText('Save v1');
    await nameIt(page, 'Country types');
    await saveButton(page).click();

    await expect(page.getByText(/Saved “Country types” as v1/)).toBeVisible();
    expect(createdQueries).toHaveLength(1);
    expect(createdQueries[0].name).toBe('Country types');
    expect(createdVersions[0].queryString).toContain('SELECT ?country');

    // The handoff: gone from Scratch, present in Saved, and still open.
    await expect(scratchRows(page)).toHaveCount(0);
    await expect(savedRows(page).filter({ hasText: 'Country types' })).toBeVisible();
    await expect(page).toHaveURL(/query=urn:sqlib:query:created-1/);
  });

  test('saves into the library the sidebar is pointing at', async ({ page }) => {
    await typeQuery(page, 'SELECT ?s WHERE { ?s ?p ?o }');
    await nameIt(page, 'Anything');
    await saveButton(page).click();

    await expect.poll(() => createdQueries.length).toBe(1);
    // Scratch reads `unassigned` until this moment; save inherits the
    // selected library rather than asking (nav doc open question, resolved).
    expect(createdQueries[0].isPartOf).toEqual([LIBRARY.id]);
  });

  test('Save on a still-unnamed item sends you to the name field, not the server', async ({ page }) => {
    await typeQuery(page, 'SELECT ?s WHERE { ?s ?p ?o }');

    await saveButton(page).click();

    // The name has exactly one editor, and this is it.
    await expect(detailsName(page)).toBeFocused();
    await expect(detailsName(page)).toHaveValue(/Untitled query \d+/);
    await expect(scratchChip(page)).toBeVisible();
    expect(createdQueries).toHaveLength(0);
    // Still there, still yours.
    await expect(scratchRows(page)).toHaveCount(1);
  });

  test('a failed save keeps the scratch item exactly where it was', async ({ page }) => {
    failNextCreate = true;
    await typeQuery(page, 'SELECT ?doomed WHERE { ?s ?p ?o }');
    await nameIt(page, 'Doomed');
    await saveButton(page).click();

    await expect(page.getByText(/Boom/)).toBeVisible();
    await expect(scratchChip(page)).toBeVisible();
    await expect(scratchRows(page)).toHaveCount(1);
    await expect(page.locator('.cm-content')).toContainText('SELECT ?doomed');
  });

  test('says so when the entity was created but its first version was not', async ({ page }) => {
    failNextVersion = true;
    await typeQuery(page, 'SELECT ?halfway WHERE { ?s ?p ?o }');
    await nameIt(page, 'Halfway');
    await saveButton(page).click();

    // Leaving a bodyless query in the library without saying so is worse than
    // saying so, and the user's text is never the thing that gets lost.
    await expect(page.getByText(/could not save its first version/)).toBeVisible();
    await expect(scratchRows(page)).toHaveCount(1);
    await expect(page.locator('.cm-content')).toContainText('SELECT ?halfway');
  });

  test('a saved query saves again on one click, asking for nothing', async ({ page }) => {
    await typeQuery(page, 'SELECT ?s WHERE { ?s ?p ?o }');
    await nameIt(page, 'Already named');
    await saveButton(page).click();
    await expect(page.getByText(/Saved “Already named” as v1/)).toBeVisible();

    // A saved query is past the naming question entirely: from here on Save
    // means vN+1 and nothing is collected — the version note is written on the
    // version's row in Details, after it exists.
    await typeQuery(page, 'SELECT ?s2 WHERE { ?s2 ?p ?o }');
    await expect(saveButton(page)).toContainText('Save v2');
    await saveButton(page).click();
    await expect(page.locator('[data-testid="version-pill"]')).toContainText('v2');
  });

  test('the Details tab says there are no versions yet rather than listing any', async ({ page }) => {
    await page.locator('[data-testid="details-tab"]').click();

    await expect(page.locator('[data-testid="no-versions"]')).toContainText('No versions yet');
    // No Library row: the sidebar and the save bar both already say where a
    // scratch query will land. The id is the row that reports the same thing,
    // and while scratch there is not one yet.
    await expect(page.locator('[data-testid="details-library"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="details-panel"]')).toContainText('not assigned');
  });

  test('naming from the Details tab means Save goes straight through', async ({ page }) => {
    await typeQuery(page, 'SELECT ?s WHERE { ?s ?p ?o }');
    await nameIt(page, 'Named up front');

    await saveButton(page).click();

    // Already named, so there is nothing to ask about.
    await expect(page.getByText(/Saved “Named up front” as v1/)).toBeVisible();
  });

  test('Save is disabled until there is something to save', async ({ page }) => {
    await expect(saveButton(page)).toBeDisabled();
    await typeQuery(page, 'SELECT ?s WHERE { ?s ?p ?o }');
    await expect(saveButton(page)).toBeEnabled();
  });
});
