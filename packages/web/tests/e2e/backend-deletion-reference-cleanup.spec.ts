import { test, expect, type Route } from '@playwright/test';
import { chooseSearchOption } from './search-select';
import { mockSidebarCollections } from './fixtures/collections';

/**
 * Test for backend deletion with automatic reference cleanup:
 *
 * When a backend is deleted:
 * 1. Any Library with defaultBackend set to that backend should have it cleared (set to null)
 * 2. Any Query with defaultBackend set to that backend should have it cleared (set to null)
 * 3. The backend itself should be successfully deleted
 */

// Mock data
let mockBackends: any[] = [];
let mockLibraries: any[] = [];
let mockQueries: any[] = [];
let mockQueryGroups: any[] = [];

test.describe('Backend Deletion with Reference Cleanup', () => {
  test.beforeEach(async ({ page }) => {
    // Reset mock data before each test
    mockBackends = [
      {
        id: 'urn:sqlib:backend:test-1',
        name: 'Test Backend 1',
        description: 'HTTP SPARQL backend',
        backendType: 'http',
        endpoint: 'http://localhost:7878/sparql',
        authEnvKey: null,
        oxigraphConfig: null,
        dateCreated: '2024-01-01T00:00:00Z',
        dateModified: '2024-01-01T00:00:00Z',
      },
      {
        id: 'urn:sqlib:backend:test-2',
        name: 'Test Backend 2',
        description: 'HTTP SPARQL backend 2',
        backendType: 'http',
        endpoint: 'http://localhost:7879/sparql',
        authEnvKey: null,
        oxigraphConfig: null,
        dateCreated: '2024-01-02T00:00:00Z',
        dateModified: '2024-01-02T00:00:00Z',
      },
    ];

    mockLibraries = [
      {
        id: 'urn:sqlib:library:test-1',
        name: 'Library with Backend 1',
        description: 'Uses Test Backend 1',
        defaultBackend: 'urn:sqlib:backend:test-1',
        dateCreated: '2024-01-01T00:00:00Z',
        dateModified: '2024-01-01T00:00:00Z',
      },
      {
        id: 'urn:sqlib:library:test-2',
        name: 'Library with No Backend',
        description: 'No default backend',
        defaultBackend: null,
        dateCreated: '2024-01-01T00:00:00Z',
        dateModified: '2024-01-01T00:00:00Z',
      },
    ];

    mockQueries = [
      {
        id: 'urn:sqlib:query:test-1',
        name: 'Query with Backend 1',
        description: 'Uses Test Backend 1',
        defaultBackend: 'urn:sqlib:backend:test-1',
        currentVersion: null,
        isPartOf: ['urn:sqlib:library:test-1'],
        dateCreated: '2024-01-01T00:00:00Z',
        dateModified: '2024-01-01T00:00:00Z',
      },
      {
        id: 'urn:sqlib:query:test-2',
        name: 'Query with Backend 2',
        description: 'Uses Test Backend 2',
        defaultBackend: 'urn:sqlib:backend:test-2',
        currentVersion: null,
        isPartOf: ['urn:sqlib:library:test-2'],
        dateCreated: '2024-01-01T00:00:00Z',
        dateModified: '2024-01-01T00:00:00Z',
      },
    ];

    mockQueryGroups = [];

    // Setup route handlers
    await setupRouteHandlers(page);

    // Navigate to home page
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  async function setupRouteHandlers(page: any) {
    // GET /backends
    // Empty defaults for every collection the sidebar loads. The routes below
    // override the ones this spec cares about; the rest exist so the sidebar's
    // Promise.all resolves instead of taking the whole tree down with it.
    await mockSidebarCollections(page);

    await page.route('**/backends', async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockBackends),
        });
      }
    });

    // DELETE /backends/:id
    await page.route('**/backends/*', async (route: Route) => {
      if (route.request().method() === 'DELETE') {
        const url = route.request().url();
        const backendId = decodeURIComponent(url.split('/backends/')[1]);

        const backendIndex = mockBackends.findIndex(b => b.id === backendId);
        if (backendIndex === -1) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Backend not found' }),
          });
          return;
        }

        // Simulate the reference cleanup behavior
        // Clear defaultBackend in all libraries
        for (const library of mockLibraries) {
          if (library.defaultBackend === backendId) {
            library.defaultBackend = null;
          }
        }

        // Clear defaultBackend in all queries
        for (const query of mockQueries) {
          if (query.defaultBackend === backendId) {
            query.defaultBackend = null;
          }
        }

        // Remove the backend
        mockBackends.splice(backendIndex, 1);

        await route.fulfill({
          status: 204,
        });
      } else if (route.request().method() === 'GET') {
        const url = route.request().url();
        const backendId = decodeURIComponent(url.split('/backends/')[1]);
        const backend = mockBackends.find(b => b.id === backendId);

        if (!backend) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Backend not found' }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(backend),
          });
        }
      }
    });

    // GET /libraries
    await page.route('**/libraries', async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockLibraries),
        });
      } else if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        const newLibrary = {
          id: `urn:sqlib:library:new-${Date.now()}`,
          name: body.name,
          description: body.description || null,
          defaultBackend: body.defaultBackend || null,
          dateCreated: new Date().toISOString(),
          dateModified: new Date().toISOString(),
        };
        mockLibraries.push(newLibrary);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          headers: { 'etag': '"test-etag"' },
          body: JSON.stringify(newLibrary),
        });
      }
    });

    // PUT /libraries/:id
    await page.route('**/libraries/*', async (route: Route) => {
      if (route.request().method() === 'PUT') {
        const url = route.request().url();
        const libraryId = decodeURIComponent(url.split('/libraries/')[1]);
        const library = mockLibraries.find(l => l.id === libraryId);

        if (!library) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Library not found' }),
          });
          return;
        }

        const body = route.request().postDataJSON();
        Object.assign(library, {
          ...body,
          dateModified: new Date().toISOString(),
        });

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'etag': '"test-etag-updated"' },
          body: JSON.stringify(library),
        });
      } else if (route.request().method() === 'GET') {
        const url = route.request().url();
        const libraryId = decodeURIComponent(url.split('/libraries/')[1]);
        const library = mockLibraries.find(l => l.id === libraryId);

        if (!library) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Library not found' }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(library),
          });
        }
      }
    });

    // GET /queries
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
          id: `urn:sqlib:query:new-${Date.now()}`,
          name: body.name,
          description: body.description || null,
          defaultBackend: body.defaultBackend || null,
          currentVersion: null,
          isPartOf: body.libraryId ? [body.libraryId] : [],
          dateCreated: new Date().toISOString(),
          dateModified: new Date().toISOString(),
        };
        mockQueries.push(newQuery);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          headers: { 'etag': '"test-etag"' },
          body: JSON.stringify(newQuery),
        });
      }
    });

    // PUT /queries/:id
    await page.route('**/queries/*', async (route: Route) => {
      if (route.request().method() === 'PUT') {
        const url = route.request().url();
        const queryId = decodeURIComponent(url.split('/queries/')[1].split('?')[0]);
        const query = mockQueries.find(q => q.id === queryId);

        if (!query) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Query not found' }),
          });
          return;
        }

        const body = route.request().postDataJSON();
        Object.assign(query, {
          ...body,
          dateModified: new Date().toISOString(),
        });

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'etag': '"test-etag-updated"' },
          body: JSON.stringify(query),
        });
      } else if (route.request().method() === 'GET') {
        const url = route.request().url();
        const queryId = decodeURIComponent(url.split('/queries/')[1].split('?')[0]);
        const query = mockQueries.find(q => q.id === queryId);

        if (!query) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Query not found' }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(query),
          });
        }
      }
    });

    // GET /query-groups
    await page.route('**/query-groups', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockQueryGroups),
      });
    });
  }

  test('should show confirmation dialog with references when deleting backend', async ({ page }) => {
    // Setup GET /backends/:id/references endpoint
    await page.route('**/backends/*/references', async (route: Route) => {
      const url = route.request().url();
      const backendId = decodeURIComponent(url.split('/backends/')[1].split('/references')[0]);

      const referencingLibraries = mockLibraries
        .filter(lib => lib.defaultBackend === backendId)
        .map(lib => ({ id: lib.id, name: lib.name }));

      const referencingQueries = mockQueries
        .filter(query => query.defaultBackend === backendId)
        .map(query => ({ id: query.id, name: query.name }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          libraries: referencingLibraries,
          queries: referencingQueries,
        }),
      });
    });

    // Expand backends section if not already expanded
    const backendsSection = page.locator('.section-header').filter({ hasText: 'Backends' });
    const backendsSectionContent = page.locator('.nav-section').filter({ has: backendsSection }).locator('.section-content');

    // Check if section is visible, if not click to expand
    const isVisible = await backendsSectionContent.isVisible().catch(() => false);
    if (!isVisible) {
      await backendsSection.locator('.section-toggle').click();
      await page.waitForTimeout(300);
    }

    // Wait for backend item to be visible
    const backendItem = page.locator('.backend-item').filter({ hasText: 'Test Backend 1' }).first();
    await expect(backendItem).toBeVisible({ timeout: 5000 });
    await backendItem.hover();

    const deleteButton = backendItem.locator('button[title*="Delete"]').first();
    await deleteButton.click();

    // Wait for confirmation dialog to appear
    await page.waitForTimeout(500);

    // Verify dialog title
    await expect(page.getByText('Delete Backend?')).toBeVisible();

    // Verify backend name in dialog
    await expect(page.getByText('"Test Backend 1"')).toBeVisible();

    // Verify references are shown
    await expect(page.getByText('This backend is used as the default by:')).toBeVisible();
    await expect(page.getByText('Library: Library with Backend 1')).toBeVisible();
    await expect(page.getByText('Query: Query with Backend 1')).toBeVisible();
    await expect(page.getByText('Their defaultBackend will be set to None')).toBeVisible();

    // Click Delete button in dialog
    const confirmDeleteButton = page.getByRole('button', { name: 'Delete' });
    await confirmDeleteButton.click();

    // Wait for deletion to complete
    await page.waitForTimeout(500);

    // Dialog should close
    await expect(page.getByText('Delete Backend?')).not.toBeVisible();

    // Verify backend is deleted from mock data
    expect(mockBackends.find(b => b.id === 'urn:sqlib:backend:test-1')).toBeUndefined();

    // Verify library's defaultBackend is now null
    expect(mockLibraries[0].defaultBackend).toBeNull();

    // Verify query's defaultBackend is now null
    expect(mockQueries[0].defaultBackend).toBeNull();
  });

  test('should show confirmation dialog without references when deleting unused backend', async ({ page }) => {
    // Create a backend with no references
    const unusedBackend = {
      id: 'urn:sqlib:backend:unused',
      name: 'Unused Backend',
      description: 'Not used by any entity',
      backendType: 'http',
      endpoint: 'http://localhost:9999/sparql',
      authEnvKey: null,
      oxigraphConfig: null,
      dateCreated: '2024-01-03T00:00:00Z',
      dateModified: '2024-01-03T00:00:00Z',
    };
    mockBackends.push(unusedBackend);

    // Setup GET /backends/:id/references endpoint
    await page.route('**/backends/*/references', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          libraries: [],
          queries: [],
        }),
      });
    });

    // Reload page to show new backend
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Expand backends section if not already expanded
    const backendsSection = page.locator('.section-header').filter({ hasText: 'Backends' });
    const backendsSectionContent = page.locator('.nav-section').filter({ has: backendsSection }).locator('.section-content');
    const isVisible = await backendsSectionContent.isVisible().catch(() => false);
    if (!isVisible) {
      await backendsSection.locator('.section-toggle').click();
      await page.waitForTimeout(300);
    }

    // Find and click delete on unused backend
    const backendItem = page.locator('.backend-item').filter({ hasText: 'Unused Backend' }).first();
    await expect(backendItem).toBeVisible({ timeout: 5000 });
    await backendItem.hover();

    const deleteButton = backendItem.locator('button[title*="Delete"]').first();
    await deleteButton.click();

    // Wait for confirmation dialog
    await page.waitForTimeout(500);

    // Verify message shows no references
    await expect(page.getByText('No entities are using this backend as their default')).toBeVisible();

    // Confirm deletion
    const confirmDeleteButton = page.getByRole('button', { name: 'Delete' });
    await confirmDeleteButton.click();

    await page.waitForTimeout(500);
    await expect(page.getByText('Delete Backend?')).not.toBeVisible();
  });

  test('should allow canceling backend deletion', async ({ page }) => {
    // Setup GET /backends/:id/references endpoint
    await page.route('**/backends/*/references', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ libraries: [], queries: [] }),
      });
    });

    const initialBackendCount = mockBackends.length;

    // Expand backends section if not already expanded
    const backendsSection = page.locator('.section-header').filter({ hasText: 'Backends' });
    const backendsSectionContent = page.locator('.nav-section').filter({ has: backendsSection }).locator('.section-content');
    const isVisible = await backendsSectionContent.isVisible().catch(() => false);
    if (!isVisible) {
      await backendsSection.locator('.section-toggle').click();
      await page.waitForTimeout(300);
    }

    // Click delete on backend 2
    const backendItem = page.locator('.backend-item').filter({ hasText: 'Test Backend 2' }).first();
    await expect(backendItem).toBeVisible({ timeout: 5000 });
    await backendItem.hover();

    const deleteButton = backendItem.locator('button[title*="Delete"]').first();
    await deleteButton.click();

    // Wait for dialog
    await page.waitForTimeout(500);

    // Verify dialog is open
    await expect(page.getByText('Delete Backend?')).toBeVisible();

    // Click Cancel
    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    await cancelButton.click();

    await page.waitForTimeout(300);

    // Dialog should close
    await expect(page.getByText('Delete Backend?')).not.toBeVisible();

    // Backend should NOT be deleted
    expect(mockBackends.length).toBe(initialBackendCount);
    expect(mockBackends.find(b => b.id === 'urn:sqlib:backend:test-2')).toBeDefined();
  });


  test('complete workflow: create library with backend, set query backend, delete backend', async ({ page }) => {
    // Setup GET /backends/:id/references endpoint
    await page.route('**/backends/*/references', async (route: Route) => {
      const url = route.request().url();
      const backendId = decodeURIComponent(url.split('/backends/')[1].split('/references')[0]);

      const referencingLibraries = mockLibraries
        .filter(lib => lib.defaultBackend === backendId)
        .map(lib => ({ id: lib.id, name: lib.name }));

      const referencingQueries = mockQueries
        .filter(query => query.defaultBackend === backendId)
        .map(query => ({ id: query.id, name: query.name }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          libraries: referencingLibraries,
          queries: referencingQueries,
        }),
      });
    });

    // Step 1: Create a new library with backend 1 as default
    const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });
    await librariesSection.locator('.section-toggle').click();
    await page.waitForTimeout(200);

    const addLibraryButton = librariesSection.locator('.add-button');
    await addLibraryButton.click();

    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

    await page.locator('#name').fill('New Library with Backend');
    await page.locator('#description').fill('This library uses Test Backend 1');
    await chooseSearchOption(page, 'defaultBackend', 'Test Backend 1');

    const createButton = page.getByRole('button', { name: 'Create Library' });
    await createButton.click();

    await expect(page.getByText('Create Library')).not.toBeVisible({ timeout: 5000 });

    // Verify library was created with correct backend
    const newLibrary = mockLibraries[mockLibraries.length - 1];
    expect(newLibrary.name).toBe('New Library with Backend');
    expect(newLibrary.defaultBackend).toBe('urn:sqlib:backend:test-1');

    // Step 2: Verify backend is referenced (we'll skip creating the query to simplify the test)
    // Just verify the library references it

    // Step 3: Delete the backend
    const backendsSection = page.locator('.section-header').filter({ hasText: 'Backends' });
    const backendsSectionContent = page.locator('.nav-section').filter({ has: backendsSection }).locator('.section-content');
    const isVisible = await backendsSectionContent.isVisible().catch(() => false);
    if (!isVisible) {
      await backendsSection.locator('.section-toggle').click();
      await page.waitForTimeout(300);
    }

    const backendItem = page.locator('.backend-item').filter({ hasText: 'Test Backend 1' }).first();
    await expect(backendItem).toBeVisible({ timeout: 5000 });
    await backendItem.hover();

    const deleteButton = backendItem.locator('button[title*="Delete"]').first();
    await deleteButton.click();

    // Wait for confirmation dialog
    await page.waitForTimeout(500);

    // Verify references are shown in dialog
    await expect(page.getByText('This backend is used as the default by:')).toBeVisible();
    await expect(page.getByText('Library: New Library with Backend')).toBeVisible();

    // Confirm deletion
    const confirmDeleteButton = page.getByRole('button', { name: 'Delete' });
    await confirmDeleteButton.click();

    await page.waitForTimeout(500);
    await expect(page.getByText('Delete Backend?')).not.toBeVisible();

    // Step 4: Verify library has its defaultBackend cleared to null
    expect(newLibrary.defaultBackend).toBeNull();

    // Verify backend is gone
    expect(mockBackends.find(b => b.id === 'urn:sqlib:backend:test-1')).toBeUndefined();
  });

  test('should handle deleting backend that is referenced by a query', async ({ page }) => {
    // Setup GET /backends/:id/references endpoint
    await page.route('**/backends/*/references', async (route: Route) => {
      const url = route.request().url();
      const backendId = decodeURIComponent(url.split('/backends/')[1].split('/references')[0]);

      const referencingLibraries = mockLibraries
        .filter(lib => lib.defaultBackend === backendId)
        .map(lib => ({ id: lib.id, name: lib.name }));

      const referencingQueries = mockQueries
        .filter(query => query.defaultBackend === backendId)
        .map(query => ({ id: query.id, name: query.name }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          libraries: referencingLibraries,
          queries: referencingQueries,
        }),
      });
    });

    // Backend 2 is only referenced by mockQueries[1]
    const initialBackendCount = mockBackends.length;
    const initialLibraryCount = mockLibraries.length;
    const initialQueryCount = mockQueries.length;

    // Expand backends section if not already expanded
    const backendsSection = page.locator('.section-header').filter({ hasText: 'Backends' });
    const backendsSectionContent = page.locator('.nav-section').filter({ has: backendsSection }).locator('.section-content');
    const isVisible = await backendsSectionContent.isVisible().catch(() => false);
    if (!isVisible) {
      await backendsSection.locator('.section-toggle').click();
      await page.waitForTimeout(300);
    }

    const backendItem = page.locator('.backend-item').filter({ hasText: 'Test Backend 2' }).first();
    await expect(backendItem).toBeVisible({ timeout: 5000 });
    await backendItem.hover();

    const deleteButton = backendItem.locator('button[title*="Delete"]').first();
    await deleteButton.click();

    // Wait for confirmation dialog
    await page.waitForTimeout(500);

    // Verify references shown
    await expect(page.getByText('Query: Query with Backend 2')).toBeVisible();

    // Confirm deletion
    const confirmDeleteButton = page.getByRole('button', { name: 'Delete' });
    await confirmDeleteButton.click();

    await page.waitForTimeout(500);

    // Verify backend 2 is deleted
    expect(mockBackends.find(b => b.id === 'urn:sqlib:backend:test-2')).toBeUndefined();
    expect(mockBackends.length).toBe(initialBackendCount - 1);

    // Verify no libraries or queries were deleted
    expect(mockLibraries.length).toBe(initialLibraryCount);
    expect(mockQueries.length).toBe(initialQueryCount);

    // Verify the query that referenced backend 2 now has null
    expect(mockQueries[1].defaultBackend).toBeNull();
  });

  test('should handle multiple entities referencing the same backend', async ({ page }) => {
    // Setup GET /backends/:id/references endpoint
    await page.route('**/backends/*/references', async (route: Route) => {
      const url = route.request().url();
      const backendId = decodeURIComponent(url.split('/backends/')[1].split('/references')[0]);

      const referencingLibraries = mockLibraries
        .filter(lib => lib.defaultBackend === backendId)
        .map(lib => ({ id: lib.id, name: lib.name }));

      const referencingQueries = mockQueries
        .filter(query => query.defaultBackend === backendId)
        .map(query => ({ id: query.id, name: query.name }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          libraries: referencingLibraries,
          queries: referencingQueries,
        }),
      });
    });

    // Add another library and query that reference backend 1
    const extraLibrary = {
      id: 'urn:sqlib:library:extra',
      name: 'Extra Library',
      description: 'Also uses backend 1',
      defaultBackend: 'urn:sqlib:backend:test-1',
      dateCreated: '2024-01-01T00:00:00Z',
      dateModified: '2024-01-01T00:00:00Z',
    };
    mockLibraries.push(extraLibrary);

    const extraQuery = {
      id: 'urn:sqlib:query:extra',
      name: 'Extra Query',
      description: 'Also uses backend 1',
      defaultBackend: 'urn:sqlib:backend:test-1',
      currentVersion: null,
      isPartOf: ['urn:sqlib:library:extra'],
      dateCreated: '2024-01-01T00:00:00Z',
      dateModified: '2024-01-01T00:00:00Z',
    };
    mockQueries.push(extraQuery);

    // Delete backend 1
    const backendsSection = page.locator('.section-header').filter({ hasText: 'Backends' });
    const backendsSectionContent = page.locator('.nav-section').filter({ has: backendsSection }).locator('.section-content');
    const isVisible = await backendsSectionContent.isVisible().catch(() => false);
    if (!isVisible) {
      await backendsSection.locator('.section-toggle').click();
      await page.waitForTimeout(300);
    }

    const backendItem = page.locator('.backend-item').filter({ hasText: 'Test Backend 1' }).first();
    await expect(backendItem).toBeVisible({ timeout: 5000 });
    await backendItem.hover();

    const deleteButton = backendItem.locator('button[title*="Delete"]').first();
    await deleteButton.click();

    // Wait for confirmation dialog
    await page.waitForTimeout(500);

    // Verify ALL references shown in dialog
    await expect(page.getByText('Library: Library with Backend 1')).toBeVisible();
    await expect(page.getByText('Library: Extra Library')).toBeVisible();
    await expect(page.getByText('Query: Query with Backend 1')).toBeVisible();
    await expect(page.getByText('Query: Extra Query')).toBeVisible();

    // Confirm deletion
    const confirmDeleteButton = page.getByRole('button', { name: 'Delete' });
    await confirmDeleteButton.click();

    await page.waitForTimeout(500);

    // Verify ALL entities that referenced backend 1 now have null
    const entitiesWithBackend1 = [
      mockLibraries[0], // Library with Backend 1
      mockQueries[0],   // Query with Backend 1
      extraLibrary,
      extraQuery,
    ];

    for (const entity of entitiesWithBackend1) {
      expect(entity.defaultBackend).toBeNull();
    }
  });
});
