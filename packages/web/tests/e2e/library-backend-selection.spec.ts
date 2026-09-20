import { test, expect, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';
import { chooseSearchOption, searchSelect } from './search-select';

/**
 * Test for library backend selection bug fix:
 * When editing a library and selecting a backend from dropdown,
 * the form should NOT auto-submit and the button should NOT get stuck in "Updating..." state.
 */

// Mock data
const mockBackends = [
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

const mockLibraries: any[] = [];
const mockQueries: any[] = [];
const mockQueryGroups: any[] = [];

test.describe('Library Backend Selection Bug Fix', () => {
  test.beforeEach(async ({ page }) => {
    // Mock all API endpoints
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
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          headers: {
            'etag': '"test-etag-create"',
          },
          body: JSON.stringify(newLibrary),
        });
      }
    });

    await page.route('**/queries', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockQueries),
      });
    });

    await page.route('**/query-groups', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockQueryGroups),
      });
    });

    // Navigate to home page
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-layout').first()).toBeVisible();
  });

  async function openAddLibraryDialog(page: any) {
    // Expand Libraries section if needed
    const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });
    const sectionToggle = librariesSection.locator('.section-toggle');
    await sectionToggle.click();
    await page.waitForTimeout(200);

    // Click the + button next to Libraries section
    const addButton = librariesSection.locator('.add-button');
    await addButton.click();

    // Wait for dialog to appear
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  }

  test('should not auto-submit when selecting backend in new library dialog', async ({ page }) => {
    await openAddLibraryDialog(page);

    // Fill in the library name
    const nameField = page.locator('#name');
    await nameField.fill('Test Library');

    // Get the submit button
    const submitButton = page.getByRole('button', { name: 'Create Library' });
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();

    // Select a backend from the dropdown
    await chooseSearchOption(page, 'defaultBackend', mockBackends[0].name);

    // Wait a moment to ensure no auto-submit happens
    await page.waitForTimeout(500);

    // Button should still show "Create Library" (not "Creating...")
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toHaveText('Create Library');

    // Dialog should still be open
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // The chooser should show the selected backend
    await expect(searchSelect(page, 'defaultBackend')).toHaveValue(mockBackends[0].name);
  });

  test('should allow multiple backend selections without auto-submitting', async ({ page }) => {
    await openAddLibraryDialog(page);

    await page.locator('#name').fill('Test Library');

    const submitButton = page.getByRole('button', { name: 'Create Library' });

    // Select first backend
    await chooseSearchOption(page, 'defaultBackend', mockBackends[0].name);
    await page.waitForTimeout(200);
    await expect(submitButton).toHaveText('Create Library');

    // Change to second backend
    await chooseSearchOption(page, 'defaultBackend', mockBackends[1].name);
    await page.waitForTimeout(200);
    await expect(submitButton).toHaveText('Create Library');

    // Change back to "None" — the chooser's own empty row
    await chooseSearchOption(page, 'defaultBackend', 'None');
    await page.waitForTimeout(200);
    await expect(submitButton).toHaveText('Create Library');

    // Dialog should still be open after all these changes
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
  });

  test('should reset button state when reopening dialog after successful creation', async ({ page }) => {
    // First creation
    await openAddLibraryDialog(page);
    await page.locator('#name').fill('First Library');
    await chooseSearchOption(page, 'defaultBackend', mockBackends[0].name);

    const submitButton = page.getByRole('button', { name: 'Create Library' });
    await submitButton.click();

    // Wait for dialog to close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 5000 });

    // Open dialog again
    await openAddLibraryDialog(page);

    // Button should NOT be stuck in "Creating..." state
    const newSubmitButton = page.getByRole('button', { name: 'Create Library' });
    await expect(newSubmitButton).toBeVisible();
    await expect(newSubmitButton).toBeEnabled();
    await expect(newSubmitButton).toHaveText('Create Library');

    // Should not have "Creating..." text anywhere
    await expect(page.getByRole('button', { name: 'Creating...' })).not.toBeVisible();
  });

  test('should not trigger form submission with Enter key in backend dropdown', async ({ page }) => {
    await openAddLibraryDialog(page);

    await page.locator('#name').fill('Test Library');

    const backendSelect = searchSelect(page, 'defaultBackend');
    const submitButton = page.getByRole('button', { name: 'Create Library' });

    // Focus the chooser and press Enter
    await backendSelect.focus();
    await backendSelect.press('Enter');
    await page.waitForTimeout(300);

    // Button should not be in loading state
    await expect(submitButton).toHaveText('Create Library');
    await expect(submitButton).toBeEnabled();

    // Dialog should still be open
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
  });

  test('should show loading state only when actually clicking submit button', async ({ page }) => {
    // Add a delay to the POST request to see loading state
    await page.route('**/libraries', async (route: Route) => {
      if (route.request().method() === 'POST') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const body = route.request().postDataJSON();
        const newLibrary = {
          id: `urn:sqlib:library:new-${Date.now()}`,
          name: body.name,
          description: body.description || null,
          defaultBackend: body.defaultBackend || null,
          dateCreated: new Date().toISOString(),
          dateModified: new Date().toISOString(),
        };
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          headers: {
            'etag': '"test-etag"',
          },
          body: JSON.stringify(newLibrary),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockLibraries),
        });
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-layout').first()).toBeVisible();

    await openAddLibraryDialog(page);

    await page.locator('#name').fill('Loading Test Library');

    // Select backend - should NOT show loading state
    await chooseSearchOption(page, 'defaultBackend', mockBackends[0].name);
    await page.waitForTimeout(200);

    const submitButtonBefore = page.getByRole('button', { name: 'Create Library' });
    await expect(submitButtonBefore).toBeVisible();

    // Now actually click submit
    await submitButtonBefore.click();

    // NOW it should show loading state
    await expect(page.getByRole('button', { name: 'Creating...' })).toBeVisible({ timeout: 1000 });

    // Eventually dialog closes
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 5000 });
  });
});
