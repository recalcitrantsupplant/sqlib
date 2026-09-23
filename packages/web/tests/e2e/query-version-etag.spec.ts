import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';
import { API_HOST } from './api-origin';


/**
 * Concurrency across a sequence of saves.
 *
 * This file was written against a Save button that PATCHed a version in place,
 * and the bug it caught was a stale If-Match after switching versions. That
 * flow is gone: a version is immutable, so the work area only ever POSTs new
 * ones. What survives is the thing the bug was really about — saving
 * repeatedly, and switching versions in between, must keep working — so the
 * sequence is asserted through Save instead.
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
  currentVersion: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

// Store etags per version to simulate proper etag handling
const versionEtags: Map<number, string> = new Map();
let mockQueryVersions: any[] = [];
let nextVersionNumber = 1;

test.describe('Saving a sequence of versions', () => {
  test.beforeEach(async ({ page }) => {
    // Reset mock data
    mockQueryVersions = [];
    nextVersionNumber = 1;
    mockQuery.currentVersion = null;
    versionEtags.clear();

    // Mock backends endpoint
    // Empty defaults for every collection the sidebar loads. The routes below
    // override the ones this spec cares about; the rest exist so the sidebar's
    // Promise.all resolves instead of taking the whole tree down with it.
    await mockSidebarCollections(page);

    await page.route(`**//${API_HOST}/backends`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockBackends),
      });
    });

    // Mock libraries endpoint
    await page.route(`**//${API_HOST}/libraries`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockLibraries),
      });
    });

    // Mock queries endpoint
    await page.route(`**//${API_HOST}/queries`, async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([mockQuery]),
        });
      }
    });

    // Mock individual query GET endpoint
    await page.route(`**//${API_HOST}/queries/urn%3Asqlib%3Aquery%3Atest-1`, async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'ETag': '"query-etag-1"',
          },
          body: JSON.stringify(mockQuery),
        });
      }
    });

    // Mock query versions list endpoint (GET /queries/:queryId/v)
    await page.route(`**//${API_HOST}/queries/urn%3Asqlib%3Aquery%3Atest-1/v`, async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockQueryVersions),
        });
      } else if (route.request().method() === 'POST') {
        // Create new version
        const body = route.request().postDataJSON();
        const newVersion = {
          id: `urn:sqlib:query:test-1:v${nextVersionNumber}`,
          version: nextVersionNumber,
          queryString: body.queryVersion.queryString,
          comment: body.queryVersion.comment || null,
          isPartOf: 'urn:sqlib:query:test-1',
          dateCreated: new Date().toISOString(),
          dateModified: new Date().toISOString(),
        };
        mockQueryVersions.push(newVersion);
        mockQuery.currentVersion = newVersion.id;

        // Store initial etag for this version
        const etag = `version-etag-${nextVersionNumber}-initial`;
        versionEtags.set(nextVersionNumber, etag);
        nextVersionNumber++;

        const responsePayload = {
          queryVersion: {
            id: newVersion.id,
            version: newVersion.version,
            queryString: newVersion.queryString,
            comment: newVersion.comment,
            isPartOf: newVersion.isPartOf,
            queryType: null,
            defaultBackend: null,
            limitParameters: null,
            offsetParameters: null,
            inferredInputs: null,
            inferredOutputs: null,
            dateCreated: newVersion.dateCreated,
            dateModified: newVersion.dateModified,
          },
          limitParameters: [],
          offsetParameters: [],
          inputs: [],
          outputs: [],
          inputTuples: [],
          outputTuples: [],
          tupleMembers: [],
          iriMap: {},
        };

        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          headers: {
            'ETag': `"${etag}"`,
          },
          body: JSON.stringify(responsePayload),
        });
      }
    });

    // Mock individual version GET/PATCH endpoint
    await page.route(`**//${API_HOST}/queries/urn%3Asqlib%3Aquery%3Atest-1/v/*`, async (route: Route) => {
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

        // Return the current etag for this version
        const currentEtag = versionEtags.get(versionNumber) || `version-etag-${versionNumber}`;

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'ETag': `"${currentEtag}"`,
          },
          body: JSON.stringify({
            queryVersion: version,
            limitParameters: [],
            offsetParameters: [],
            inputs: [],
            outputs: [],
            inputTuples: [],
            outputTuples: [],
            tupleMembers: [],
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

        // Check If-Match header for etag validation
        const ifMatchHeader = route.request().headers()['if-match'];
        const currentEtag = versionEtags.get(versionNumber);

        console.log(`PATCH v${versionNumber}: If-Match="${ifMatchHeader}", Current ETag="${currentEtag}"`);

        if (ifMatchHeader && currentEtag) {
          // Strip quotes from both for comparison
          const requestEtag = ifMatchHeader.replace(/"/g, '');
          const storedEtag = currentEtag;

          if (requestEtag !== storedEtag) {
            console.log(`ETag mismatch! Request: "${requestEtag}", Stored: "${storedEtag}"`);
            await route.fulfill({
              status: 412,
              contentType: 'application/json',
              body: JSON.stringify({
                error: 'Precondition Failed',
                message: 'ETag does not match current version'
              }),
            });
            return;
          }
        }

        // Update the version
        const body = route.request().postDataJSON();
        version.queryString = body.queryString;
        version.comment = body.comment || null;
        version.dateModified = new Date().toISOString();

        // Generate new etag after update
        const newEtag = `version-etag-${versionNumber}-${Date.now()}`;
        versionEtags.set(versionNumber, newEtag);

        console.log(`Updated v${versionNumber} with new ETag: "${newEtag}"`);

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'ETag': `"${newEtag}"`,
          },
          body: JSON.stringify({
            queryVersion: version,
            limitParameters: [],
            offsetParameters: [],
            inputs: [],
            outputs: [],
            inputTuples: [],
            outputTuples: [],
            tupleMembers: [],
          }),
        });
      } else if (route.request().method() === 'DELETE') {
        const index = mockQueryVersions.findIndex(v => v.version === versionNumber);
        if (index !== -1) {
          mockQueryVersions.splice(index, 1);
          versionEtags.delete(versionNumber);
        }

        await route.fulfill({
          status: 204,
        });
      }
    });

    // Mock query groups endpoint
    await page.route(`**//${API_HOST}/query-groups`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

  });

  /** Replace the editor body and wait past the 500ms draft autosave. */
  async function typeQuery(page: Page, text: string) {
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(text);
    await expect(editor).toContainText(text.slice(0, 20));
    await page.waitForTimeout(700);
  }

  async function save(page: Page, expectedVersion: number) {
    const button = page.locator('[data-testid="save"]');
    await expect(button).toContainText(`Save v${expectedVersion}`);
    await button.click();
    await expect(page.locator('[data-testid="version-pill"]')).toContainText(`v${expectedVersion}`);
  }

  test('saves three versions in a row', async ({ page }) => {
    await page.goto('/?query=urn:sqlib:query:test-1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.query-work-area');

    await typeQuery(page, 'SELECT ?v1 WHERE { ?s ?p ?o } LIMIT 10');
    await save(page, 1);

    await typeQuery(page, 'SELECT ?v2 WHERE { ?s ?p ?o } LIMIT 20');
    await save(page, 2);

    await typeQuery(page, 'SELECT ?v3 WHERE { ?s ?p ?o } LIMIT 30');
    await save(page, 3);

    expect(mockQueryVersions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(mockQueryVersions.at(-1).queryString).toContain('SELECT ?v3');
  });

  test('saving after looking back at an older version saves what is in the editor', async ({ page }) => {
    await page.goto('/?query=urn:sqlib:query:test-1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.query-work-area');

    await typeQuery(page, 'SELECT ?v1 WHERE { ?s ?p ?o } LIMIT 10');
    await save(page, 1);
    await typeQuery(page, 'SELECT ?v2 WHERE { ?s ?p ?o } LIMIT 20');
    await save(page, 2);

    // Switching back to v1 is a read, not an edit — this is where the original
    // bug lived, when the token from the version you left was reused. The
    // switch is a Details version row now rather than the editor's selector.
    await page.locator('[data-testid="details-tab"]').click();
    await page.locator('[data-testid="toggle-version-history"]').click();
    await page.locator('[data-testid="version-row"]').filter({ hasText: 'v1' }).click();
    await expect(page.locator('.cm-content')).toContainText('SELECT ?v1');

    await typeQuery(page, 'SELECT ?v3 WHERE { ?s ?p ?o } LIMIT 30');
    await save(page, 3);
    expect(mockQueryVersions.at(-1).queryString).toContain('SELECT ?v3');
  });
});

