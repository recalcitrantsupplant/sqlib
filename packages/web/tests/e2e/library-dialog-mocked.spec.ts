import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';
import { chooseSearchOption, openSearchSelect, searchSelect } from './search-select';

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

const mockLibraries = [
  {
    id: 'urn:sqlib:library:test-1',
    name: 'Test Library 1',
    description: 'A test library',
    defaultBackend: null,
    dateCreated: '2024-01-01T00:00:00Z',
    dateModified: '2024-01-01T00:00:00Z',
  },
];

const mockQueries: any[] = [];
const mockQueryGroups: any[] = [];

test.describe('Add Library Dialog (Mocked)', () => {
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

  async function openAddLibraryDialog(page: Page) {
    // Expand Libraries section if needed
    const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });
    const sectionToggle = librariesSection.locator('.section-toggle');
    await sectionToggle.click();

    // Wait a bit for section to expand
    await page.waitForTimeout(200);

    // Click the + button next to Libraries section
    const addButton = librariesSection.locator('.add-button');
    await addButton.click();

    // Wait for dialog to appear
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  }

  test('should open library dialog when clicking + button', async ({ page }) => {
    await openAddLibraryDialog(page);

    // Check dialog is visible
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Check dialog title
    await expect(page.getByRole('heading', { name: 'Add Library' })).toBeVisible();

    // Check dialog description (partial text match)
    await expect(page.getByText('Create a new library')).toBeVisible();
  });

  test('should display all form fields', async ({ page }) => {
    await openAddLibraryDialog(page);

    // Check Name field (required)
    const nameField = page.locator('#name');
    await expect(nameField).toBeVisible();
    // Check for required indicator
    await expect(page.locator('label[for="name"] .required')).toBeVisible();

    // Check Description field (optional)
    const descriptionField = page.locator('#description');
    await expect(descriptionField).toBeVisible();

    // Check Default Backend chooser (optional)
    await expect(searchSelect(page, 'defaultBackend')).toBeVisible();

    // Check buttons
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Library' })).toBeVisible();
  });

  test('should close dialog when clicking Cancel', async ({ page }) => {
    await openAddLibraryDialog(page);

    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    await cancelButton.click();

    // Dialog should be closed
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test('should close dialog when clicking X button', async ({ page }) => {
    await openAddLibraryDialog(page);

    // Click the X close button
    const closeButton = page.locator('[role="dialog"]').getByRole('button', { name: 'Close' });
    await closeButton.click();

    // Dialog should be closed
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test('should require name field', async ({ page }) => {
    await openAddLibraryDialog(page);

    const nameField = page.locator('#name');

    // Clear any value and blur to trigger validation
    await nameField.clear();
    await nameField.blur();

    // Try to submit without filling name
    const submitButton = page.getByRole('button', { name: 'Create Library' });
    await submitButton.click();

    // Dialog should still be visible (HTML5 validation prevents submit)
    await expect(page.locator('[role="dialog"]')).toBeVisible();
  });

  test('should populate backend dropdown with available backends', async ({ page }) => {
    await openAddLibraryDialog(page);

    // The chooser's rows exist once it is open: "None" plus the backends.
    const options = await openSearchSelect(page, 'defaultBackend');
    expect(await options.count()).toBeGreaterThanOrEqual(2);

    const rows = (await options.allTextContents()).join(' ');
    expect(rows).toContain('Test Backend 1');
    expect(rows).toContain('Test Backend 2');
  });

  test('should create library with name only', async ({ page }) => {
    await openAddLibraryDialog(page);

    // Fill in name
    const nameField = page.locator('#name');
    await nameField.fill('My New Library');

    // Submit
    const submitButton = page.getByRole('button', { name: 'Create Library' });
    await submitButton.click();

    // Wait for dialog to close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 3000 });
  });

  test('should create library with all fields filled', async ({ page }) => {
    await openAddLibraryDialog(page);

    // Fill in all fields
    await page.locator('#name').fill('Complete Library');
    await page.locator('#description').fill('This is a complete library with all fields');

    // Select a backend by name
    await chooseSearchOption(page, 'defaultBackend', 'Test Backend 1');

    // Submit
    await page.getByRole('button', { name: 'Create Library' }).click();

    // Wait for dialog to close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 3000 });
  });

  test('should show loading state during submission', async ({ page }) => {
    // Add a delay to the POST request to see loading state
    await page.route('**/libraries', async (route: Route) => {
      if (route.request().method() === 'POST') {
        await new Promise(resolve => setTimeout(resolve, 500));
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

    const submitButton = page.getByRole('button', { name: 'Create Library' });
    await submitButton.click();

    // Check for loading state (button text changes)
    await expect(page.getByRole('button', { name: 'Creating...' })).toBeVisible({ timeout: 1000 });

    // Eventually dialog closes
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 5000 });
  });

  test('should handle empty description as null', async ({ page }) => {
    await openAddLibraryDialog(page);

    await page.locator('#name').fill('Library Without Description');
    // Leave description empty

    await page.getByRole('button', { name: 'Create Library' }).click();
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 3000 });
  });

  test('should clear form when reopening dialog after successful creation', async ({ page }) => {
    // Create first library
    await openAddLibraryDialog(page);
    await page.locator('#name').fill('First Library');
    await page.getByRole('button', { name: 'Create Library' }).click();
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();

    // Open dialog again
    await openAddLibraryDialog(page);

    // Fields should be empty
    const nameValue = await page.locator('#name').inputValue();
    expect(nameValue).toBe('');

    const descriptionValue = await page.locator('#description').inputValue();
    expect(descriptionValue).toBe('');
  });
});
