import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
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

    // Navigate to main page
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-layout').first()).toBeVisible();
  });

  /*
   * Expanding is idempotent on purpose. These used to be bare clicks, which
   * work the first time and COLLAPSE the tree on the second call — so any test
   * that opened the dialog twice, or re-checked the sidebar after creating a
   * query, was clicking things shut and then waiting for them.
   */
  async function ensureExpanded(toggle: Locator) {
    const arrow = toggle.locator('.arrow').first();
    if (!(await arrow.evaluate((el) => el.classList.contains('expanded')))) {
      await toggle.click();
      await expect(arrow).toHaveClass(/expanded/);
    }
  }

  const libraryToggleFor = (page: Page) =>
    page.locator('.library-toggle').filter({ hasText: 'Test Query Library' });
  const queriesCategoryFor = (page: Page) =>
    page.locator('.category-header').filter({ hasText: 'Queries' }).first();

  async function openAddQueryDialog(page: Page) {
    await ensureExpanded(libraryToggleFor(page));
    await ensureExpanded(queriesCategoryFor(page));

    const addButton = page.getByRole('button', { name: 'Add Query', exact: true });
    await addButton.first().click();

    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  }

  test('should open query dialog when clicking add button', async ({ page }) => {
    await openAddQueryDialog(page);

    // Check dialog is visible
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Check dialog title
    await expect(page.getByRole('heading', { name: 'Add Query' })).toBeVisible();

    // Check dialog description contains library name
    await expect(page.getByText(/Create a new query in Test Query Library/)).toBeVisible();
  });

  test('should display all form fields in query dialog', async ({ page }) => {
    await openAddQueryDialog(page);

    // Check Name field (required)
    const nameField = page.locator('#name');
    await expect(nameField).toBeVisible();
    await expect(page.locator('label[for="name"] .required')).toBeVisible();

    // Check Description field
    const descriptionField = page.locator('#description');
    await expect(descriptionField).toBeVisible();

    // Check Default Backend chooser
    await expect(searchSelect(page, 'default-backend')).toBeVisible();

    // Check buttons
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Query' })).toBeVisible();
  });

  test('should close dialog when clicking Cancel', async ({ page }) => {
    await openAddQueryDialog(page);

    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    await cancelButton.click();

    // Dialog should be closed
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test('should create a new query via dialog', async ({ page }) => {
    await openAddQueryDialog(page);

    // Fill in query name
    const nameField = page.locator('#name');
    await nameField.fill('My Test Query');

    // Fill in description
    const descriptionField = page.locator('#description');
    await descriptionField.fill('This is a test query for CRUD operations');

    // Submit the form
    const createButton = page.getByRole('button', { name: 'Create Query' });
    await createButton.click();

    // Wait for dialog to close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 3000 });

    // Verify query appears in navigation
    // Expand library again to see updated list
    await ensureExpanded(libraryToggleFor(page));
    await ensureExpanded(queriesCategoryFor(page));

    await expect(page.locator('.item-button').filter({ hasText: 'My Test Query' })).toBeVisible();
  });

  test('should require name field', async ({ page }) => {
    await openAddQueryDialog(page);

    const nameField = page.locator('#name');

    // Clear any value
    await nameField.clear();
    await nameField.blur();

    // Try to submit without filling name
    const submitButton = page.getByRole('button', { name: 'Create Query' });
    await submitButton.click();

    // Dialog should still be visible (HTML5 validation prevents submit)
    await expect(page.locator('[role="dialog"]')).toBeVisible();
  });

  test('should populate backend dropdown', async ({ page }) => {
    await openAddQueryDialog(page);

    // The chooser's rows exist once it is open.
    const options = await openSearchSelect(page, 'default-backend');
    expect((await options.allTextContents()).join(' ')).toContain('Test SPARQL Backend');
  });

  test('should create query with all fields filled', async ({ page }) => {
    await openAddQueryDialog(page);

    // Fill in all fields
    await page.locator('#name').fill('Complete Query');
    await page.locator('#description').fill('A complete query with all fields');

    // Select a backend, by typing enough of its name to rank it first
    await filterAndChooseFirst(page, 'default-backend', 'Test SPARQL');

    // Submit
    await page.getByRole('button', { name: 'Create Query' }).click();

    // Wait for dialog to close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 3000 });
  });

  test('should show loading state during submission', async ({ page }) => {
    // Add a delay to the POST request
    await page.route('**/queries', async (route: Route) => {
      if (route.request().method() === 'POST') {
        await new Promise(resolve => setTimeout(resolve, 500));
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
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newQuery),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockQueries),
        });
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-layout').first()).toBeVisible();

    await openAddQueryDialog(page);

    await page.locator('#name').fill('Loading Test Query');

    const submitButton = page.getByRole('button', { name: 'Create Query' });
    await submitButton.click();

    // Check for loading state
    await expect(page.getByRole('button', { name: 'Creating...' })).toBeVisible({ timeout: 1000 });

    // Eventually dialog closes
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 5000 });
  });

  test('should clear form when reopening dialog', async ({ page }) => {
    // Create first query
    await openAddQueryDialog(page);
    await page.locator('#name').fill('First Query');
    await page.getByRole('button', { name: 'Create Query' }).click();
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();

    // Open dialog again
    await openAddQueryDialog(page);

    // Fields should be empty
    const nameValue = await page.locator('#name').inputValue();
    expect(nameValue).toBe('');

    const descriptionValue = await page.locator('#description').inputValue();
    expect(descriptionValue).toBe('');
  });

  test('should display empty state when no queries exist', async ({ page }) => {
    // Expand Libraries section
    const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });
    await expect(librariesSection).toBeVisible();

    // Expand the library
    const libraryToggle = page.locator('.library-toggle').filter({ hasText: 'Test Query Library' });
    await libraryToggle.click();
    await page.waitForTimeout(200);

    // Expand Queries category
    const queriesCategory = page.locator('.category-header').filter({ hasText: 'Queries' }).first();
    await queriesCategory.click();
    await page.waitForTimeout(200);

    // Should show "No queries yet" message
    await expect(page.getByText('No queries yet')).toBeVisible();
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

    // Reload page to pick up new data
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-layout').first()).toBeVisible();

    // Expand library and Queries category
    const libraryToggle = page.locator('.library-toggle').filter({ hasText: 'Test Query Library' });
    await libraryToggle.click();
    await page.waitForTimeout(200);

    const queriesCategory = page.locator('.category-header').filter({ hasText: 'Queries' }).first();
    await queriesCategory.click();
    await page.waitForTimeout(200);

    // Query should be visible
    const queryButton = page.locator('.item-button').filter({ hasText: 'Existing Test Query' });
    await expect(queryButton).toBeVisible();
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

    // Reload page
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-layout').first()).toBeVisible();

    // Expand library and queries
    const libraryToggle = page.locator('.library-toggle').filter({ hasText: 'Test Query Library' });
    await libraryToggle.click();
    await page.waitForTimeout(200);

    const queriesCategory = page.locator('.category-header').filter({ hasText: 'Queries' }).first();
    await queriesCategory.click();
    await page.waitForTimeout(200);

    // Verify all queries are visible
    await expect(page.locator('.item-button').filter({ hasText: 'Query Alpha' })).toBeVisible();
    await expect(page.locator('.item-button').filter({ hasText: 'Query Beta' })).toBeVisible();
    await expect(page.locator('.item-button').filter({ hasText: 'Query Gamma' })).toBeVisible();
  });
});