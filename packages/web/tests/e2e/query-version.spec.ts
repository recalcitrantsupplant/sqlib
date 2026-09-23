import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';

/**
 * Versions, through the draft/save model that replaced Save.
 *
 * A versioned entity cannot be edited in place, so there is no "save this
 * version": edits accumulate in a browser-local draft and Save turns them
 * into vN+1. That changes what is worth asserting. The old spec checked that
 * a button called Save issued a POST or a PATCH; these check the three things
 * a user can now lose work to — an edit that never reached the draft, a
 * save that failed and took the edits with it, and a discard that left them
 * behind.
 */

// Mock data
const mockBackends = [
  {
    id: 'urn:sqlib:backend:test-1',
    name: 'Wikidata',
    description: 'Wikidata SPARQL endpoint',
    backendType: 'http',
    endpoint: 'https://query.wikidata.org/sparql',
    authEnvKey: null,
    oxigraphConfig: null,
    dateCreated: '2024-01-01T00:00:00Z',
    dateModified: '2024-01-01T00:00:00Z',
  },
];

const mockLibraries = [
  {
    id: 'urn:sqlib:library:test-1',
    name: 'Test Library',
    description: 'A test library',
    defaultBackend: null,
    dateCreated: '2024-01-01T00:00:00Z',
    dateModified: '2024-01-01T00:00:00Z',
  },
];

const mockQuery = {
  id: 'urn:sqlib:query:test-1',
  name: 'Test Query',
  description: 'A test query',
  defaultBackend: null,
  isPartOf: ['urn:sqlib:library:test-1'],
  currentVersion: null, // No version initially
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

let mockQueryVersions: any[] = [];
let nextVersionNumber = 1;
/** Saving is the only thing that writes; the count proves nothing else does. */
let versionPostCount = 0;
let failNextVersionPost = false;

/**
 * A version IRI as the API mints them: `urn:sqlib:query-version:<local>`.
 *
 * These used to be `urn:sqlib:query:test-1:vN` — the *entity's* prefix with a
 * version suffix, a shape nothing produces. It went unnoticed because the
 * sidebar's version badge parsed the number back out of it, so the fixture and
 * the client agreed with each other and with nothing else.
 */
function versionIri(number: number): string {
  return `urn:sqlib:query-version:test-1-${number}`;
}

function version(number: number, queryString: string, comment: string) {
  return {
    id: versionIri(number),
    version: number,
    queryString,
    comment,
    isPartOf: 'urn:sqlib:query:test-1',
    dateCreated: '2024-01-01T00:00:00Z',
  };
}

function seedOneVersion() {
  mockQueryVersions = [version(1, 'SELECT * WHERE { ?s ?p ?o }', 'Original version')];
  nextVersionNumber = 2;
  mockQuery.currentVersion = versionIri(1);
}

const saveButton = (page: Page) => page.locator('[data-testid="save"]');

/** Entity writes the Details tab issued, and deletes. */
let identityPuts: Array<{ name?: string; description?: string | null; currentVersion?: string | null }> = [];
let deleteCount = 0;

/**
 * Save. One click — nothing to confirm.
 *
 * Saving used to ask for a version note first; the note is now written on the
 * version's own row in the Details tab, so Save just saves.
 */
async function saveAndConfirm(page: Page) {
  await page.locator('[data-testid="save"]').click();
}

async function openQuery(page: Page) {
  await page.goto('/?query=urn:sqlib:query:test-1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.query-work-area');
  await expect(page.locator('[data-testid="save-bar"]')).toBeVisible();
}

/** Replace the editor body and wait past the 500ms autosave debounce. */
async function typeQuery(page: Page, text: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await expect(editor).toContainText(text.slice(0, 20));
  await page.waitForTimeout(700);
}

test.describe('Query Version', () => {
  test.beforeEach(async ({ page }) => {
    // Reset mock data
    mockQueryVersions = [];
    nextVersionNumber = 1;
    versionPostCount = 0;
    failNextVersionPost = false;
    mockQuery.currentVersion = null;
    mockQuery.name = 'Test Query';
    mockQuery.description = 'A test query';
    identityPuts = [];
    deleteCount = 0;

    // Mock backends endpoint - must include full URL to intercept properly
    // Empty defaults for every collection the sidebar loads. The routes below
    // override the ones this spec cares about; the rest exist so the sidebar's
    // Promise.all resolves instead of taking the whole tree down with it.
    await mockSidebarCollections(page);

    await page.route('**//localhost:3000/backends', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockBackends),
      });
    });

    // Mock libraries endpoint
    await page.route('**//localhost:3000/libraries', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockLibraries),
      });
    });

    // Mock queries endpoint
    await page.route('**//localhost:3000/queries', async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([mockQuery]),
        });
      }
    });

    // The query entity: GET reads it, PUT saves its name and description, and
    // DELETE removes it. PUT and DELETE used to fall through unhandled, which
    // was invisible while nothing could issue them.
    await page.route('**//localhost:3000/queries/urn%3Asqlib%3Aquery%3Atest-1', async (route: Route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'ETag': '"query-etag-1"',
          },
          body: JSON.stringify(mockQuery),
        });
        return;
      }
      if (method === 'PUT' || method === 'PATCH') {
        const body = route.request().postDataJSON() as {
          name?: string;
          description?: string | null;
          currentVersion?: string | null;
        };
        identityPuts.push(body);
        if (body.name !== undefined) mockQuery.name = body.name;
        if (body.description !== undefined) mockQuery.description = body.description ?? '';
        if (body.currentVersion !== undefined) mockQuery.currentVersion = body.currentVersion;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { ETag: '"query-etag-2"' },
          body: JSON.stringify(mockQuery),
        });
        return;
      }
      if (method === 'DELETE') {
        deleteCount += 1;
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      await route.fallback();
    });

    // Mock query versions list endpoint (GET /queries/:queryId/v)
    // Note: URL-encoded version to match actual requests
    await page.route('**//localhost:3000/queries/urn%3Asqlib%3Aquery%3Atest-1/v', async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockQueryVersions),
        });
      } else if (route.request().method() === 'POST') {
        versionPostCount += 1;
        if (failNextVersionPost) {
          failNextVersionPost = false;
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Boom: the server refused this version' }),
          });
          return;
        }
        // Create new version
        const body = route.request().postDataJSON();
        const newVersion = {
          id: versionIri(nextVersionNumber),
          version: nextVersionNumber,
          queryString: body.queryVersion.queryString,
          comment: body.queryVersion.comment || null,
          isPartOf: 'urn:sqlib:query:test-1',
          dateCreated: new Date().toISOString(),
          dateModified: new Date().toISOString(),
        };
        mockQueryVersions.push(newVersion);
        mockQuery.currentVersion = newVersion.id;
        nextVersionNumber++;

        // POST returns expanded structure with iriMap (as per backend)
        // Must match queryVersionExpandedWithIriMapSchema
        const responsePayload = {
          queryVersion: {
            id: newVersion.id,
            version: newVersion.version,
            queryString: newVersion.queryString,
            comment: newVersion.comment,
            isPartOf: newVersion.isPartOf, // Required by queryVersionSchema
            queryType: null,
            defaultBackend: null,
            limitParameters: null,
            offsetParameters: null,
            inferredInputs: null,
            inferredOutputs: null,
            dateCreated: newVersion.dateCreated,
            dateModified: newVersion.dateModified,
          },
          limitParameters: [], // Required array by queryVersionExpandedSchema
          offsetParameters: [], // Required array
          inputs: [], // Required array
          outputs: [], // Required array
          inputTuples: [], // Required array
          outputTuples: [], // Required array
          tupleMembers: [], // Required array
          iriMap: {}, // Required by queryVersionExpandedWithIriMapSchema
        };

        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          headers: {
            'ETag': `"version-etag-${newVersion.version}"`,
          },
          body: JSON.stringify(responsePayload),
        });
      }
    });

    // Mock individual version GET/PATCH endpoint
    // Note: URL-encoded version to match actual requests
    await page.route('**//localhost:3000/queries/urn%3Asqlib%3Aquery%3Atest-1/v/*', async (route: Route) => {
      const versionNumber = parseInt(route.request().url().split('/').pop() || '0');
      const version = mockQueryVersions.find(v => v.version === versionNumber);

      if (route.request().method() === 'GET') {
        if (!version) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Version not found' }),
          });
          return;
        }

        // GET returns expanded structure (queryVersionExpandedSchema)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'ETag': `"version-etag-${version.version}"`,
          },
          body: JSON.stringify({
            queryVersion: version,
            limitParameters: [], // Required array
            offsetParameters: [], // Required array
            inputs: [], // Required array
            outputs: [], // Required array
            inputTuples: [], // Required array
            outputTuples: [], // Required array
            tupleMembers: [], // Required array
          }),
        });
      } else if (route.request().method() === 'PATCH') {
        if (!version) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Version not found' }),
          });
          return;
        }

        const body = route.request().postDataJSON();
        // A note-only PATCH sends no body: annotating a version must not blank
        // out the query it belongs to.
        if (body.queryString !== undefined) version.queryString = body.queryString;
        if (body.comment !== undefined) version.comment = body.comment || null;

        // PATCH returns expanded structure (queryVersionExpandedSchema)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'ETag': `"version-etag-${version.version}-updated"`,
          },
          body: JSON.stringify({
            queryVersion: version,
            limitParameters: [], // Required array
            offsetParameters: [], // Required array
            inputs: [], // Required array
            outputs: [], // Required array
            inputTuples: [], // Required array
            outputTuples: [], // Required array
            tupleMembers: [], // Required array
          }),
        });
      } else if (route.request().method() === 'DELETE') {
        const index = mockQueryVersions.findIndex(v => v.version === versionNumber);
        if (index !== -1) {
          mockQueryVersions.splice(index, 1);
        }

        await route.fulfill({
          status: 204,
        });
      }
    });

    // Mock query groups endpoint
    await page.route('**//localhost:3000/query-groups', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

  });

  test('holds an edit as an unsaved draft rather than writing it', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);

    await typeQuery(page, 'SELECT ?draftEdit WHERE { ?s ?p ?o }');

    // The pill counts what is not in a version yet. Where the edits are kept
    // in the meantime is not something the UI claims: "saved locally" said
    // `save` about browser storage while the button beside it said the same
    // word about a version on the server.
    await expect(page.locator('[data-testid="draft-pill"]')).toContainText('1 unsaved edit');
    await expect(page.locator('[data-testid="saved-locally"]')).toHaveCount(0);
    // Nothing reached the server: saving is the only thing that writes.
    expect(versionPostCount).toBe(0);
  });

  test('keeps the draft across a reload — the edits are the point of keeping them', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await typeQuery(page, 'SELECT ?survivesReload WHERE { ?s ?p ?o }');
    await expect(page.locator('[data-testid="draft-pill"]')).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.query-work-area');

    // A draft outranks the saved version in the editor: coming back to the
    // query means coming back to your work.
    await expect(page.locator('.cm-content')).toContainText('SELECT ?survivesReload');
    await expect(page.locator('[data-testid="draft-pill"]')).toBeVisible();
  });

  test('typing back to the saved body clears the draft rather than counting it', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);

    await typeQuery(page, 'SELECT ?changed WHERE { ?s ?p ?o }');
    await expect(page.locator('[data-testid="draft-pill"]')).toBeVisible();

    // An undo is not an edit; if it were, the dot would never clear.
    await typeQuery(page, 'SELECT * WHERE { ?s ?p ?o }');
    await expect(page.locator('[data-testid="draft-pill"]')).toHaveCount(0);
  });

  test('Save creates the next version and clears the draft', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await typeQuery(page, 'SELECT ?saved WHERE { ?s ?p ?o }');

    await expect(saveButton(page)).toContainText('Save v2');
    await saveAndConfirm(page);

    await expect(page.getByText(/New version 2 created successfully/)).toBeVisible();
    // The draft has become a version, so the draft state goes away entirely.
    await expect(page.locator('[data-testid="draft-pill"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="version-pill"]')).toContainText('v2');
    expect(mockQueryVersions.at(-1).queryString).toContain('SELECT ?saved');
  });

  test('Save is disabled when there is nothing to save', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);

    // No edits: saving would mint a version identical to the last one.
    await expect(saveButton(page)).toBeDisabled();
    await typeQuery(page, 'SELECT ?somethingNew WHERE { ?s ?p ?o }');
    await expect(saveButton(page)).toBeEnabled();
  });

  test('a failed save keeps the draft — the edits must not vanish with it', async ({ page }) => {
    seedOneVersion();
    failNextVersionPost = true;
    await openQuery(page);
    await typeQuery(page, 'SELECT ?doomed WHERE { ?s ?p ?o }');

    await saveAndConfirm(page);
    await expect(page.getByText(/Boom/)).toBeVisible();

    await expect(page.locator('[data-testid="draft-pill"]')).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('SELECT ?doomed');
    await expect(page.locator('[data-testid="version-pill"]')).toContainText('v1');
  });

  test('Discard throws the edits away and restores the saved body', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await typeQuery(page, 'SELECT ?regretted WHERE { ?s ?p ?o }');
    await expect(page.locator('[data-testid="draft-pill"]')).toBeVisible();

    await page.locator('[data-testid="discard-draft"]').click();

    await expect(page.locator('[data-testid="draft-pill"]')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toContainText('SELECT * WHERE');
    await expect(page.locator('.cm-content')).not.toContainText('?regretted');
  });

  test('the first Save on a query with no versions is v1', async ({ page }) => {
    // No seeding: the query exists but has never been given a body.
    await openQuery(page);
    await typeQuery(page, 'SELECT ?first WHERE { ?s ?p ?o }');

    await expect(saveButton(page)).toContainText('Save v1');
    await saveAndConfirm(page);

    await expect(page.getByText(/New version 1 created successfully/)).toBeVisible();
    await expect(page.locator('[data-testid="version-pill"]')).toContainText('v1');
  });

  test('the Details tab pins the draft above the versions', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await typeQuery(page, 'SELECT ?pinned WHERE { ?s ?p ?o }');

    await page.locator('[data-testid="details-tab"]').click();

    // The draft is the one row that needs a decision — save it or throw it
    // away — so it sits above the versions rather than under them.
    const draftRow = page.locator('[data-testid="draft-version-row"]');
    await expect(draftRow).toContainText('Draft');
    await expect(draftRow).toContainText('1 edit');
    await expect(page.locator('[data-testid="version-row"]')).toHaveCount(1);

    // Looking at v1 and coming back to the draft is two clicks, and the body
    // follows the click both ways.
    await page.locator('[data-testid="version-row"]').first().click();
    await expect(page.locator('.cm-content')).toContainText('SELECT * WHERE');
    await draftRow.click();
    await expect(page.locator('.cm-content')).toContainText('SELECT ?pinned');
  });

  test('each version row copies its own version id', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    const row = page.locator('[data-testid="version-row"]').first();
    await row.hover();
    await row.locator('[data-testid="copy-version-id"]').click();

    await expect(page.getByText(/Copied v1's version id/)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(versionIri(1));
    // Copying is not opening: the row's own click must not fire.
    await expect(row).toHaveClass(/current/);
  });

  /*
   * Details is the only place identity lives now. It used to be in two: the
   * metadata panel above the editor, whose Edit dialog saved, and the Details
   * tab, whose inputs did not — they set a local ref and the change was gone
   * on the next load. These pin the single surviving route.
   */
  test('there is no metadata panel above the editor any more', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);

    await expect(page.locator('.metadata-section-compact')).toHaveCount(0);
    // And what it uniquely carried is still reachable — in the Details tab,
    // which is also where Delete went when the save bar's ⋮ was removed.
    await page.locator('[data-testid="details-tab"]').click();
    await expect(page.locator('[data-testid="details-delete"]')).toBeVisible();
  });

  test('renaming in the Details tab saves it', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await page.locator('[data-testid="details-name"]').fill('Renamed in place');
    await expect.poll(() => identityPuts.map((put) => put.name)).toContain('Renamed in place');
  });

  test('a description typed in the Details tab saves it', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await page.locator('[data-testid="details-description"]').fill('Now with a description');
    await expect
      .poll(() => identityPuts.map((put) => put.description))
      .toContain('Now with a description');
  });

  test('renaming does not create a version — the body is what gets saved', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await page.locator('[data-testid="details-name"]').fill('Just a rename');
    await expect.poll(() => identityPuts.length).toBeGreaterThan(0);
    expect(versionPostCount).toBe(0);
  });

  /*
   * Delete lives in the Details tab, and confirms in place there rather than
   * in a dialog. The save bar's ⋮ menu held the only other copy and is gone —
   * one affordance for an irreversible action, in the panel that holds the
   * rest of the query's identity.
   */
  test('Delete asks first, then deletes', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await page.locator('[data-testid="details-delete"]').click();

    // Confirmed rather than immediate: unlike everything else here it is not
    // held in the browser first, and it takes every version with it.
    await expect(page.getByText('Delete this query and its one version?')).toBeVisible();
    expect(deleteCount).toBe(0);

    await page.locator('[data-testid="details-confirm-delete"]').click();
    await expect.poll(() => deleteCount).toBe(1);
  });

  test('cancelling the delete confirm deletes nothing', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await page.locator('[data-testid="details-delete"]').click();
    await page.locator('[data-testid="details-cancel-delete"]').click();

    await expect(page.locator('[data-testid="details-confirm-delete"]')).toHaveCount(0);
    expect(deleteCount).toBe(0);
  });

  test('there is no Save button left to press', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);

    // Autosave plus Save replaces it. Anything still offering to "save" a
    // version would be a second, disagreeing route to the same endpoint.
    await expect(page.locator('.btn-save')).toHaveCount(0);
  });

  /*
   * Version switching left the editor with the toolbar it lived in. It is the
   * Details tab's version rows now, which is where the mockup puts it — so
   * these assert the same two behaviours through the surface that survived.
   */
  test('switches between versions from the Details tab', async ({ page }) => {
    mockQueryVersions = [
      version(1, 'SELECT ?v1 WHERE { ?s ?p ?o }', 'Version 1'),
      version(2, 'SELECT ?v2 WHERE { ?s ?p ?o }', 'Version 2'),
    ];
    nextVersionNumber = 3;
    mockQuery.currentVersion = versionIri(2);
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await expect(page.locator('.cm-content')).toContainText('SELECT ?v2 WHERE');

    // Collapsed the list shows the current version; the older ones are one
    // click below it.
    await expect(page.locator('[data-testid="version-row"]')).toHaveCount(1);
    await page.locator('[data-testid="toggle-version-history"]').click();
    await page.locator('[data-testid="version-row"]').filter({ hasText: 'v1' }).click();
    await expect(page.locator('.cm-content')).toContainText('SELECT ?v1 WHERE');
  });

  test('each version carries its own comment in the Details list', async ({ page }) => {
    mockQueryVersions = [
      version(1, 'SELECT ?v1 WHERE { ?s ?p ?o }', 'First version comment'),
      version(2, 'SELECT ?v2 WHERE { ?s ?p ?o }', 'Second version comment'),
    ];
    nextVersionNumber = 3;
    mockQuery.currentVersion = versionIri(2);
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    // Both comments are readable at once — with the history open — which the
    // single comment field the editor used to carry could never do.
    await page.locator('[data-testid="toggle-version-history"]').click();
    await expect(page.locator('[data-testid="version-row"]').filter({ hasText: 'v1' }))
      .toContainText('First version comment');
    await expect(page.locator('[data-testid="version-row"]').filter({ hasText: 'v2' }))
      .toContainText('Second version comment');
  });

  /*
   * The description is a box that grows to what it holds, capped at three
   * lines. A description long enough to be cut off says so — the fade and the
   * "more" — rather than hiding the rest behind a caret.
   */
  test('a long description is capped at three lines until "more" opens it', async ({ page }) => {
    mockQuery.description = 'Native Jena facet counts (luc:facet) for a search term, grouped by a '
      + 'chosen field. Returns one row per facet value with its count, ordered by count '
      + 'descending, so the caller can render a facet panel without a second round trip.';
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    const description = page.locator('[data-testid="details-description"]');
    const toggle = page.locator('[data-testid="details-description-toggle"]');
    await expect(toggle).toHaveText('more');

    const clamped = await description.evaluate((element) => element.clientHeight);
    await toggle.click();
    await expect(toggle).toHaveText('less');
    const opened = await description.evaluate((element) => element.clientHeight);
    expect(opened).toBeGreaterThan(clamped);

    // And it closes again, back to the same three lines.
    await toggle.click();
    await expect.poll(() => description.evaluate((element) => element.clientHeight)).toBe(clamped);
  });

  test('a description that fits gets no "more"', async ({ page }) => {
    mockQuery.description = 'Short enough';
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await expect(page.locator('[data-testid="details-description"]')).toBeVisible();
    await expect(page.locator('[data-testid="details-description-toggle"]')).toHaveCount(0);
  });

  /*
   * Which version is current used to be a dropdown in the Edit-details dialog,
   * behind the save bar's ⋮ menu. The dialog is gone — every field it
   * carried is a Details control — so these assert the choice through the row
   * that replaced it.
   */
  test('the Details tab points the query at another version', async ({ page }) => {
    mockQueryVersions = [
      version(1, 'SELECT ?v1 WHERE { ?s ?p ?o }', 'Version 1'),
      version(2, 'SELECT ?v2 WHERE { ?s ?p ?o }', 'Version 2'),
    ];
    nextVersionNumber = 3;
    mockQuery.currentVersion = versionIri(2);
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await page.locator('[data-testid="toggle-version-history"]').click();
    const v1Line = page.locator('[data-testid="version-row"]').filter({ hasText: 'v1' });
    await v1Line.locator('[data-testid="set-current-version"]').click();

    await expect.poll(() => identityPuts.at(-1)?.currentVersion).toBe(versionIri(1));
    // The row that is current says so, and the one that no longer is offers
    // the button instead.
    await expect(v1Line.locator('[data-testid="current-version-tag"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="version-row"]').filter({ hasText: 'v2' }).locator('[data-testid="set-current-version"]'),
    ).toBeVisible();
  });

  /*
   * Diff sits with Format and the prefix conversions in the editor's header
   * row, not in the save bar: it reframes the document, and the save bar is
   * about the query and its versions. The rules screen makes the same split.
   */
  test('Diff is in the editor header row, and opens the diff', async ({ page }) => {
    mockQueryVersions = [
      version(1, 'SELECT ?v1 WHERE { ?s ?p ?o }', 'Version 1'),
      version(2, 'SELECT ?v2 WHERE { ?s ?p ?o }', 'Version 2'),
    ];
    nextVersionNumber = 3;
    mockQuery.currentVersion = versionIri(2);
    await openQuery(page);

    const diff = page.locator('.panel-header__actions [data-testid="diff-query"]');
    await expect(diff).toBeVisible();
    await diff.click();

    await expect(page.locator('.sparql-diff-viewer')).toBeVisible();
  });

  test('Diff says so rather than doing nothing when there is one version', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);

    const diff = page.locator('.panel-header__actions [data-testid="diff-query"]');
    await expect(diff).toBeDisabled();
    await expect(diff).toHaveAttribute('title', 'Nothing to diff yet — there is one version');
  });

  test('there is no Edit-details dialog left to open, and no menu either', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);

    // The ⋮ menu existed for Delete; Delete is in the Details tab, so the menu
    // is one door too many and is gone with the dialog it used to offer.
    await expect(page.locator('[data-testid="query-more"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="query-edit-details"]')).toHaveCount(0);
  });

  test('save takes one click and asks for nothing', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await typeQuery(page, 'SELECT ?uncommented WHERE { ?s ?p ?o }');

    await page.locator('[data-testid="save"]').click();

    await expect.poll(() => mockQueryVersions.length).toBe(2);
    await expect(page.locator('[data-testid="comment-input"]')).toHaveCount(0);
  });

  test('a version note is written on its row in Details', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    // The empty note invites the click that fills it; a version saved without
    // one can still be annotated afterwards, which the save-time prompt could
    // never do.
    const row = page.locator('[data-testid="version-row"]').filter({ hasText: 'v1' });
    await row.locator('[data-testid="version-comment-edit"]').click();
    await page.locator('[data-testid="version-comment-input"]').fill('why this changed');
    await page.locator('[data-testid="version-comment-input"]').press('Enter');

    await expect.poll(() => mockQueryVersions[0]?.comment).toBe('why this changed');
    await expect(row).toContainText('why this changed');
  });

  /*
   * The Details panel's redesign: the id whole rather than its last six
   * characters, the history folded away behind one click, and the footer
   * carrying the creation date and the delete.
   */
  test('the Details tab shows the whole query id, not the last six characters', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    // The one thing anyone does with an id is paste it somewhere, and an
    // elided one cannot be pasted.
    await expect(page.locator('[data-testid="details-id"]')).toHaveText('urn:sqlib:query:test-1');
  });

  test('the version history folds away to what is being looked at', async ({ page }) => {
    mockQueryVersions = [
      version(1, 'SELECT ?v1 WHERE { ?s ?p ?o }', 'Version 1'),
      version(2, 'SELECT ?v2 WHERE { ?s ?p ?o }', 'Version 2'),
      version(3, 'SELECT ?v3 WHERE { ?s ?p ?o }', 'Version 3'),
    ];
    nextVersionNumber = 4;
    mockQuery.currentVersion = versionIri(3);
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    const rows = page.locator('[data-testid="version-row"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('v3');

    const toggle = page.locator('[data-testid="toggle-version-history"]');
    await expect(toggle).toContainText('Show history (2)');
    await toggle.click();
    await expect(rows).toHaveCount(3);

    await expect(toggle).toContainText('Hide history');
    await toggle.click();
    await expect(rows).toHaveCount(1);
  });

  test('the version being read stays in the collapsed list', async ({ page }) => {
    mockQueryVersions = [
      version(1, 'SELECT ?v1 WHERE { ?s ?p ?o }', 'Version 1'),
      version(2, 'SELECT ?v2 WHERE { ?s ?p ?o }', 'Version 2'),
    ];
    nextVersionNumber = 3;
    mockQuery.currentVersion = versionIri(2);
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await page.locator('[data-testid="toggle-version-history"]').click();
    await page.locator('[data-testid="version-row"]').filter({ hasText: 'v1' }).click();

    // Folding the history back up must not hide the row whose body is on
    // screen: current and selected are both "what am I looking at".
    await page.locator('[data-testid="toggle-version-history"]').click();
    await expect(page.locator('[data-testid="version-row"]')).toHaveCount(2);
  });

  test('the Details footer deletes the query, confirming in place', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await expect(page.locator('[data-testid="details-created"]')).toContainText('Created');

    await page.locator('[data-testid="details-delete"]').click();
    // Confirmed rather than immediate — it goes straight to the server and
    // takes every version with it — but confirmed in the strip that asked.
    await expect(page.locator('[data-testid="details-footer"]'))
      .toContainText('Delete this query and its one version?');
    expect(deleteCount).toBe(0);

    await page.locator('[data-testid="details-confirm-delete"]').click();
    await expect.poll(() => deleteCount).toBe(1);
  });

  test('cancelling the Details footer delete deletes nothing', async ({ page }) => {
    seedOneVersion();
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await page.locator('[data-testid="details-delete"]').click();
    await page.locator('[data-testid="details-cancel-delete"]').click();

    await expect(page.locator('[data-testid="details-delete"]')).toBeVisible();
    expect(deleteCount).toBe(0);
  });

  test('a version row opens the diff against current', async ({ page }) => {
    mockQueryVersions = [
      version(1, 'SELECT ?v1 WHERE { ?s ?p ?o }', 'Version 1'),
      version(2, 'SELECT ?v2 WHERE { ?s ?p ?o }', 'Version 2'),
    ];
    nextVersionNumber = 3;
    mockQuery.currentVersion = versionIri(2);
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();

    await page.locator('[data-testid="toggle-version-history"]').click();
    // The current row has nothing to compare itself with.
    await expect(
      page.locator('[data-testid="version-row"]').filter({ hasText: 'v2' })
        .locator('[data-testid="compare-version"]'),
    ).toHaveCount(0);

    await page.locator('[data-testid="version-row"]').filter({ hasText: 'v1' })
      .locator('[data-testid="compare-version"]').click();

    // No picker: the comparison is always against what callers get.
    await expect(page.locator('.sparql-diff-viewer')).toBeVisible();
    // Left is the row that was clicked, right is current.
    await expect(page.locator('.focus-diff-controls')).toContainText('v1');
    await expect(page.locator('.focus-diff-controls')).toContainText('v2');
  });

  test('the Details list gains a row once the query has versions', async ({ page }) => {
    await openQuery(page);
    await page.locator('[data-testid="details-tab"]').click();
    await expect(page.locator('[data-testid="version-row"]')).toHaveCount(0);

    await typeQuery(page, 'SELECT * WHERE { ?s ?p ?o }');
    await saveAndConfirm(page);

    await expect(page.locator('[data-testid="version-row"]')).toHaveCount(1);
  });
});
