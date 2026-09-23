import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { openSection, openSplash } from './navigate';
import { filterAndChooseFirst, openSearchSelect, searchSelect } from './search-select';
import { mockSidebarCollections } from './fixtures/collections';

// Mock data matching exact contract schemas
const mockBackends = [
  {
    id: 'urn:sqlib:backend:test-backend-1',
    name: 'Test SPARQL Backend',
    description: 'HTTP SPARQL endpoint for testing',
    backendType: 'http',
    endpoint: 'http://localhost:7878/sparql',
    authEnvKey: null,
    oxigraphConfig: null,
    dateCreated: new Date().toISOString(),
    dateModified: new Date().toISOString(),
  },
];

let mockLibraries = [
  {
    id: 'urn:sqlib:library:test-lib-1',
    name: 'Test Query Library',
    description: 'A library for testing query CRUD operations',
    defaultBackend: null,
    dateCreated: new Date().toISOString(),
    dateModified: new Date().toISOString(),
  },
];

// Start with empty queries array - will be populated during tests
let mockQueries: any[] = [];

const mockQueryGroups: any[] = [];
const mockRules: any[] = [];
const mockDataBlocks: any[] = [];
const mockRuleSets: any[] = [];

test.describe('Query CRUD Operations (Mocked)', () => {
  test.beforeEach(async ({ page }) => {
    // Reset queries before each test
    mockQueries = [];

    // Mock backends endpoint
    // Empty defaults for every collection the sidebar loads. The routes below
    // override the ones this spec cares about; the rest exist so the sidebar's
    // Promise.all resolves instead of taking the whole tree down with it.
    await mockSidebarCollections(page);

    await page.route('**/backends', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockBackends),
      });
    });

    // Mock libraries endpoint
    await page.route('**/libraries', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockLibraries),
      });
    });

    // Mock queries endpoint - handles GET and POST
    await page.route('**/queries', async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockQueries),
        });
      } else if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        const newQuery = {
          id: `urn:sqlib:query:${Date.now()}`,
          name: body.name,
          description: body.description || null,
          currentVersion: null,
          defaultBackend: body.defaultBackend || null,
          isPartOf: Array.isArray(body.isPartOf) ? body.isPartOf : [body.isPartOf],
          dateCreated: new Date().toISOString(),
          dateModified: new Date().toISOString(),
        };
        mockQueries.push(newQuery);

        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newQuery),
        });
      }
    });

    // Mock individual query endpoints - GET, PUT, DELETE
    await page.route('**/queries/*', async (route: Route) => {
      const url = route.request().url();
      const queryId = decodeURIComponent(url.split('/queries/')[1]);

      if (route.request().method() === 'GET') {
        const query = mockQueries.find(q => q.id === queryId);
        if (query) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(query),
          });
        } else {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Query not found' }),
          });
        }
      } else if (route.request().method() === 'PUT') {
        const queryIndex = mockQueries.findIndex(q => q.id === queryId);
        if (queryIndex !== -1) {
          const body = route.request().postDataJSON();
          mockQueries[queryIndex] = {
            ...mockQueries[queryIndex],
            ...body,
            dateModified: new Date().toISOString(),
          };
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockQueries[queryIndex]),
          });
        } else {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Query not found' }),
          });
        }
      } else if (route.request().method() === 'DELETE') {
        const queryIndex = mockQueries.findIndex(q => q.id === queryId);
        if (queryIndex !== -1) {
          mockQueries.splice(queryIndex, 1);
          await route.fulfill({
            status: 204,
          });
        } else {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Query not found' }),
          });
        }
      }
    });

    // Mock query groups endpoint
    await page.route('**/query-groups', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockQueryGroups),
      });
    });

    // Mock rules endpoint
    await page.route('**/rules', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockRules),
      });
    });

    // Mock data blocks endpoint
    await page.route('**/data-blocks', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockDataBlocks),
      });
    });

    // Mock rule sets endpoint
    await page.route('**/rule-sets', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockRuleSets),
      });
    });

    await openSplash(page);
  });

  /*
   * The Add Query dialog is gone, and with it every test that drove it.
   *
   * It was the artifact tree's creation path, and the tree was removed: a
   * section creates an unsaved item in its own list instead, which
   * `section-sidebars.spec.ts` and `query-scratch.spec.ts` cover. What is left
   * here is what this spec was always also about — that the queries the API
   * returns are the queries the sidebar lists.
   */

  test('lists nothing under Saved when no queries exist', async ({ page }) => {
    // The Queries section's own sidebar, which replaced the artifact tree.
    // Opening an empty section starts a scratch query, so the list is never
    // literally empty — what "no queries" means here is an empty Saved
    // cluster.
    await openSection(page, 'queries');
    await expect(page.locator('[data-testid="entity-list-sidebar"] [data-testid="saved-row"]')).toHaveCount(0);
  });

  test('should display created queries in navigation', async ({ page }) => {
    // Add a query to mock data
    mockQueries.push({
      id: 'urn:sqlib:query:existing-1',
      name: 'Existing Test Query',
      description: 'An existing query to display',
      currentVersion: null,
      defaultBackend: null,
      isPartOf: ['urn:sqlib:library:test-lib-1'],
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString(),
    });

    await openSection(page, 'queries');

    await expect(
      page.locator('[data-testid="entity-list-sidebar"]').getByText('Existing Test Query'),
    ).toBeVisible();
  });

  test('should display multiple queries in navigation', async ({ page }) => {
    // Add multiple queries
    mockQueries.push(
      {
        id: 'urn:sqlib:query:multi-1',
        name: 'Query Alpha',
        description: 'First query',
        currentVersion: null,
        defaultBackend: null,
        isPartOf: ['urn:sqlib:library:test-lib-1'],
        dateCreated: new Date().toISOString(),
        dateModified: new Date().toISOString(),
      },
      {
        id: 'urn:sqlib:query:multi-2',
        name: 'Query Beta',
        description: 'Second query',
        currentVersion: null,
        defaultBackend: null,
        isPartOf: ['urn:sqlib:library:test-lib-1'],
        dateCreated: new Date().toISOString(),
        dateModified: new Date().toISOString(),
      },
      {
        id: 'urn:sqlib:query:multi-3',
        name: 'Query Gamma',
        description: 'Third query',
        currentVersion: null,
        defaultBackend: null,
        isPartOf: ['urn:sqlib:library:test-lib-1'],
        dateCreated: new Date().toISOString(),
        dateModified: new Date().toISOString(),
      }
    );

    await openSection(page, 'queries');

    const sidebar = page.locator('[data-testid="entity-list-sidebar"]');
    await expect(sidebar.getByText('Query Alpha')).toBeVisible();
    await expect(sidebar.getByText('Query Beta')).toBeVisible();
    await expect(sidebar.getByText('Query Gamma')).toBeVisible();
  });
});
