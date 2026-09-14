import { test, expect, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';
import { chooseSearchOption, searchSelect } from './search-select';

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

const TEST_LIBRARY_ID = 'urn:sqlib:library:test-without-backend';
const mockLibraries = [
  {
    id: TEST_LIBRARY_ID,
    name: 'Library Without Backend',
    description: 'A test library with no default backend',
    defaultBackend: null,
    dateCreated: '2024-01-01T00:00:00Z',
    dateModified: '2024-01-01T00:00:00Z',
  },
];

const mockQueries: any[] = [];
const mockQueryGroups: any[] = [];

async function openAddLibraryDialog(page: any) {
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

test.describe('Library Edit - Backend Selection', () => {
  test.beforeEach(async ({ page }) => {
    // Mock GET /backends
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

    // Mock GET /libraries
    await page.route('**/libraries', async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockLibraries),
        });
      }
    });

    // Mock GET /queries
    await page.route('**/queries', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockQueries),
      });
    });

    // Mock GET /query-groups
    await page.route('**/query-groups', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockQueryGroups),
      });
    });

    // Navigate to home page
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  /*
   * Drives the real UI. The previous version dispatched a custom event that
   * nothing listens for, then poked window.__VUE_APP__, then clicked the
   * "Libraries" text — which COLLAPSES the section, since it starts expanded —
   * and finally waited for a dialog that was never going to open.
   *
   * The edit button lives inside .library-actions and is revealed on hover.
   */
  async function openLibraryEditDialog(page: Page) {
    const libraryItem = page.locator('.library-item').filter({ hasText: 'Library Without Backend' }).first();
    await expect(libraryItem).toBeVisible();
    await libraryItem.hover();
    await libraryItem.getByTitle('Edit Library').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }

  test('should open edit dialog with pre-populated fields', async ({ page }) => {
    await openLibraryEditDialog(page);

    // Check dialog is visible
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Check dialog title shows "Edit Library"
    await expect(page.getByRole('heading', { name: 'Edit Library' })).toBeVisible();

    // Check that the name field is pre-filled
    const nameField = page.locator('#name');
    await expect(nameField).toHaveValue('Library Without Backend');

    // Nothing chosen reads as the chooser's empty row, by its label.
    await expect(searchSelect(page, 'defaultBackend')).toHaveValue('None');
  });

  test('should allow selecting a backend without auto-submitting', async ({ page }) => {
    await openLibraryEditDialog(page);

    // Get the submit button initial text
    const submitButton = page.getByRole('button', { name: 'Update Library' });
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();

    // Select a backend from the dropdown
    const backendSelect = searchSelect(page, 'defaultBackend');
    await chooseSearchOption(page, 'defaultBackend', mockBackends[0].name);

    // Wait a moment to ensure no auto-submit happens
    await page.waitForTimeout(500);

    // Button should still show "Update Library" (not "Updating...")
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toHaveText('Update Library');

    // Dialog should still be open
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // The dropdown should show the selected backend
    await expect(backendSelect).toHaveValue(mockBackends[0].name);
  });

  test('should not show "Updating..." state when changing backend dropdown', async ({ page }) => {
    await openLibraryEditDialog(page);

    const submitButton = page.getByRole('button', { name: 'Update Library' });

    // Select first backend
    await chooseSearchOption(page, 'defaultBackend', mockBackends[0].name);
    await page.waitForTimeout(200);

    // Button should not be in loading state
    await expect(submitButton).not.toHaveText('Updating...');
    await expect(submitButton).toBeEnabled();

    // Change to second backend
    await chooseSearchOption(page, 'defaultBackend', mockBackends[1].name);
    await page.waitForTimeout(200);

    // Button should still not be in loading state
    await expect(submitButton).not.toHaveText('Updating...');
    await expect(submitButton).toBeEnabled();

    // Change back to "None" — the chooser's own empty row.
    await chooseSearchOption(page, 'defaultBackend', 'None');
    await page.waitForTimeout(200);

    // Button should still not be in loading state
    await expect(submitButton).not.toHaveText('Updating...');
    await expect(submitButton).toBeEnabled();
  });

  test('should successfully update library when clicking Update button', async ({ page }) => {
    // Mock PUT /libraries/:id
    let updateCalled = false;
    let updatedLibraryData: any = null;

    await page.route(`**/libraries/${encodeURIComponent(TEST_LIBRARY_ID)}`, async (route: Route) => {
      if (route.request().method() !== 'PUT') {
        await route.fallback();
        return;
      }
      {
        updateCalled = true;
        updatedLibraryData = route.request().postDataJSON();

        const updatedLibrary = {
          ...mockLibraries[0],
          ...updatedLibraryData,
          dateModified: new Date().toISOString(),
        };

        /*
         * Held briefly so the request is actually in flight for a moment.
         *
         * Fulfilled immediately, this mock resolves in the same tick the click
         * schedules it, so "Updating..." could be entered and left inside one
         * frame and the assertion below raced the render. Observed failing once
         * on CI and passing on the re-run of the same commit, which is the
         * worst shape a test can have. The loading state is a real claim this
         * file makes (three tests below assert it does *not* appear), so the
         * fix is to give it a window to appear in rather than to stop looking.
         */
        await new Promise(resolve => setTimeout(resolve, 250));

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'etag': '"test-etag"',
          },
          body: JSON.stringify(updatedLibrary),
        });
      }
    });

    await openLibraryEditDialog(page);

    // Select a backend
    await chooseSearchOption(page, 'defaultBackend', mockBackends[0].name);

    // Click Update Library button
    const submitButton = page.getByRole('button', { name: 'Update Library' });
    await submitButton.click();

    // Button should show loading state
    await expect(page.getByRole('button', { name: 'Updating...' })).toBeVisible({ timeout: 1000 });

    // Wait for dialog to close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 5000 });

    // Verify API was called
    expect(updateCalled).toBeTruthy();
    expect(updatedLibraryData).toBeTruthy();
    expect(updatedLibraryData.defaultBackend).toBe(mockBackends[0].id);
  });

  test('should reset form state when reopening dialog after successful update', async ({ page }) => {
    // Mock PUT /libraries/:id
    await page.route(`**/libraries/${encodeURIComponent(TEST_LIBRARY_ID)}`, async (route: Route) => {
      if (route.request().method() === 'PUT') {
        const updatedLibraryData = route.request().postDataJSON();
        const updatedLibrary = {
          ...mockLibraries[0],
          ...updatedLibraryData,
          dateModified: new Date().toISOString(),
        };

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'etag': '"test-etag"',
          },
          body: JSON.stringify(updatedLibrary),
        });
      }
    });

    // First edit: select backend and save
    await openLibraryEditDialog(page);

    await chooseSearchOption(page, 'defaultBackend', mockBackends[0].name);

    const submitButton = page.getByRole('button', { name: 'Update Library' });
    await submitButton.click();

    // Wait for dialog to close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 5000 });

    // Open edit dialog again
    await openLibraryEditDialog(page);

    // Button should NOT be stuck in "Updating..." state
    const newSubmitButton = page.getByRole('button', { name: 'Update Library' });
    await expect(newSubmitButton).toBeVisible();
    await expect(newSubmitButton).toBeEnabled();
    await expect(newSubmitButton).toHaveText('Update Library');

    // Should not have "Updating..." text
    await expect(page.getByRole('button', { name: 'Updating...' })).not.toBeVisible();
  });

  test('should allow multiple backend changes before submitting', async ({ page }) => {
    await openLibraryEditDialog(page);

    const backendSelect = searchSelect(page, 'defaultBackend');
    const submitButton = page.getByRole('button', { name: 'Update Library' });

    // Select first backend
    await chooseSearchOption(page, 'defaultBackend', mockBackends[0].name);
    await page.waitForTimeout(100);
    await expect(submitButton).toHaveText('Update Library');

    // Change to second backend
    await chooseSearchOption(page, 'defaultBackend', mockBackends[1].name);
    await page.waitForTimeout(100);
    await expect(submitButton).toHaveText('Update Library');

    // Change back to first backend
    await chooseSearchOption(page, 'defaultBackend', mockBackends[0].name);
    await page.waitForTimeout(100);
    await expect(submitButton).toHaveText('Update Library');

    // Dialog should still be open with no auto-submission
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Final selection should be the last one chosen
    await expect(backendSelect).toHaveValue(mockBackends[0].name);
  });

  test('should cancel edit without saving changes', async ({ page }) => {
    await openLibraryEditDialog(page);

    // Select a backend
    await chooseSearchOption(page, 'defaultBackend', mockBackends[0].name);

    // Click Cancel button
    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    await cancelButton.click();

    // Dialog should close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test('should handle Enter key in backend dropdown without submitting', async ({ page }) => {
    await openLibraryEditDialog(page);

    const backendSelect = searchSelect(page, 'defaultBackend');
    const submitButton = page.getByRole('button', { name: 'Update Library' });

    // Focus on the select
    await backendSelect.focus();

    // Press Enter key
    await backendSelect.press('Enter');
    await page.waitForTimeout(200);

    // Button should not be in loading state
    await expect(submitButton).toHaveText('Update Library');
    await expect(submitButton).toBeEnabled();

    // Dialog should still be open
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
  });
});
