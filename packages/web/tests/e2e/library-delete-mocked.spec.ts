import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';

let mockLibraries = [
  {
    id: 'urn:sqlib:library:test-1',
    name: 'Test Library 1',
    description: 'A test library',
    defaultBackend: null,
    dateCreated: '2024-01-01T00:00:00Z',
    dateModified: '2024-01-01T00:00:00Z',
  },
  {
    id: 'urn:sqlib:library:test-2',
    name: 'Test Library 2',
    description: null,
    defaultBackend: null,
    dateCreated: '2024-01-02T00:00:00Z',
    dateModified: '2024-01-02T00:00:00Z',
  },
];

const mockBackends: any[] = [];
const mockQueries: any[] = [];
const mockQueryGroups: any[] = [];

test.describe('Delete Library Functionality (Mocked)', () => {
  test.beforeEach(async ({ page }) => {
    // Reset libraries for each test
    mockLibraries = [
      {
        id: 'urn:sqlib:library:test-1',
        name: 'Test Library 1',
        description: 'A test library',
        defaultBackend: null,
        dateCreated: '2024-01-01T00:00:00Z',
        dateModified: '2024-01-01T00:00:00Z',
      },
      {
        id: 'urn:sqlib:library:test-2',
        name: 'Test Library 2',
        description: null,
        defaultBackend: null,
        dateCreated: '2024-01-02T00:00:00Z',
        dateModified: '2024-01-02T00:00:00Z',
      },
    ];

    // Every collection the sidebar loads, then the delete-aware library route
    // on top of it. Without the rules-suite collections the sidebar's
    // Promise.all rejects and no library ever renders.
    await mockSidebarCollections(page, {
      backends: mockBackends,
      queries: mockQueries,
      queryGroups: mockQueryGroups,
    });

    /*
     * Two routes, not one. The old single '**\/libraries*' pattern could not
     * match the delete URL at all: in a Playwright glob '*' does not cross a
     * '/', so '/libraries/urn%3A...' never matched and every DELETE went to
     * the network instead of the mock.
     */
    await page.route('**/libraries', async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockLibraries),
      });
    });

    await page.route('**/libraries/*', async (route: Route) => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback();
        return;
      }
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
      const index = mockLibraries.findIndex((lib) => lib.id === id);
      if (index === -1) {
        await route.fulfill({ status: 404, body: JSON.stringify({ error: 'Library not found' }) });
        return;
      }
      mockLibraries.splice(index, 1);
      await route.fulfill({ status: 204, body: '' });
    });

    // Navigate to home page
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  async function expandLibrariesSection(page: Page) {
    const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });
    const arrow = librariesSection.locator('.arrow');
    const isExpanded = await arrow.evaluate(el => el.classList.contains('expanded'));

    if (!isExpanded) {
      await librariesSection.locator('.section-toggle').click();
      await page.waitForTimeout(200);
    }
  }

  test('should show delete button on hover', async ({ page }) => {
    await expandLibrariesSection(page);

    const firstLibrary = page.locator('.library-item').first();
    const deleteButton = firstLibrary.locator('.delete-button-small');

    // Delete button should have opacity 0 initially
    await expect(deleteButton).toHaveCSS('opacity', '0');

    // Hover over library
    await firstLibrary.hover();

    // Delete button should become visible (opacity 1)
    await expect(deleteButton).toHaveCSS('opacity', '1');
  });

  test('should show trash icon in delete button', async ({ page }) => {
    await expandLibrariesSection(page);

    const firstLibrary = page.locator('.library-item').first();
    await firstLibrary.hover();

    // Check for trash icon (SVG)
    const deleteButton = firstLibrary.locator('.delete-button-small');
    const svg = deleteButton.locator('svg');
    await expect(svg).toBeVisible();
  });

  test('should open confirmation dialog when clicking delete', async ({ page }) => {
    await expandLibrariesSection(page);

    const firstLibrary = page.locator('.library-item').first();
    const libraryName = await firstLibrary.locator('.item-name').textContent();

    // Hover and click delete
    await firstLibrary.hover();
    await firstLibrary.locator('.delete-button-small').click();

    // Wait for confirmation dialog
    await page.waitForSelector('[role="alertdialog"]', { timeout: 3000 });

    // Check dialog contents
    await expect(page.getByRole('heading', { name: 'Delete Library?' })).toBeVisible();
    await expect(page.getByText(`Are you sure you want to delete "${libraryName}"`)).toBeVisible();
    await expect(page.getByText('This action cannot be undone')).toBeVisible();
  });

  test('should have Cancel and Delete buttons in confirmation dialog', async ({ page }) => {
    await expandLibrariesSection(page);

    const firstLibrary = page.locator('.library-item').first();
    await firstLibrary.hover();
    await firstLibrary.locator('.delete-button-small').click();

    await page.waitForSelector('[role="alertdialog"]');

    // Check buttons
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  test('should close confirmation dialog when clicking Cancel', async ({ page }) => {
    await expandLibrariesSection(page);

    const firstLibrary = page.locator('.library-item').first();
    const libraryName = await firstLibrary.locator('.item-name').textContent();

    await firstLibrary.hover();
    await firstLibrary.locator('.delete-button-small').click();
    await page.waitForSelector('[role="alertdialog"]');

    // Click Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Dialog should close
    await expect(page.locator('[role="alertdialog"]')).not.toBeVisible();

    // Library should still exist (check in the library items)
    const libraryStillExists = await page.locator('.library-item').filter({ hasText: libraryName! }).count();
    expect(libraryStillExists).toBeGreaterThan(0);
  });

  test('should delete library when confirming', async ({ page }) => {
    await expandLibrariesSection(page);

    // Get library name and count before deleting
    const firstLibrary = page.locator('.library-item').first();
    const libraryName = await firstLibrary.locator('.item-name').textContent();
    const initialCount = await page.locator('.library-item').count();

    // Delete it
    await firstLibrary.hover();
    await firstLibrary.locator('.delete-button-small').click();
    await page.waitForSelector('[role="alertdialog"]');
    await page.getByRole('button', { name: 'Delete' }).click();

    // Dialog should close
    await expect(page.locator('[role="alertdialog"]')).not.toBeVisible({ timeout: 2000 });

    // Wait for sidebar refresh
    await page.waitForTimeout(1000);

    // Check library count decreased
    const finalCount = await page.locator('.library-item').count();
    expect(finalCount).toBe(initialCount - 1);
  });

  test('should update library count after deletion', async ({ page }) => {
    await expandLibrariesSection(page);

    // Count libraries before
    const initialCount = await page.locator('.library-item').count();

    // Delete first library
    const firstLibrary = page.locator('.library-item').first();
    await firstLibrary.hover();
    await firstLibrary.locator('.delete-button-small').click();
    await page.waitForSelector('[role="alertdialog"]');
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(500);

    // Count libraries after
    const finalCount = await page.locator('.library-item').count();

    expect(finalCount).toBe(initialCount - 1);
  });

  test('should delete correct library when multiple exist', async ({ page }) => {
    await expandLibrariesSection(page);

    const libraries = page.locator('.library-item');
    const libraryCount = await libraries.count();

    if (libraryCount < 2) {
      console.log('Skipping test: need at least 2 libraries');
      return;
    }

    const secondLibrary = libraries.nth(1);
    const secondLibraryName = await secondLibrary.locator('.item-name').textContent();
    const firstLibraryName = await libraries.first().locator('.item-name').textContent();

    // Delete second library
    await secondLibrary.hover();
    await secondLibrary.locator('.delete-button-small').click();
    await page.waitForSelector('[role="alertdialog"]');

    // Confirm library name in dialog
    await expect(page.getByText(`"${secondLibraryName}"`)).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(1000);

    // Check the library count decreased
    const finalCount = await page.locator('.library-item').count();
    expect(finalCount).toBe(libraryCount - 1);

    // First library should still exist (check within library items)
    const firstStillExists = await page.locator('.library-item').filter({ hasText: firstLibraryName! }).count();
    expect(firstStillExists).toBeGreaterThan(0);
  });

  test('should not trigger delete when clicking library name', async ({ page }) => {
    await expandLibrariesSection(page);

    const firstLibrary = page.locator('.library-item').first();
    const libraryToggle = firstLibrary.locator('.library-toggle');

    // Click library toggle
    await libraryToggle.click();

    // Delete confirmation should NOT appear
    await expect(page.locator('[role="alertdialog"]')).not.toBeVisible();
  });

  test('should close dialog when pressing ESC key', async ({ page }) => {
    await expandLibrariesSection(page);

    const firstLibrary = page.locator('.library-item').first();
    await firstLibrary.hover();
    await firstLibrary.locator('.delete-button-small').click();
    await page.waitForSelector('[role="alertdialog"]');

    // Press ESC
    await page.keyboard.press('Escape');

    // Dialog should close
    await expect(page.locator('[role="alertdialog"]')).not.toBeVisible();
  });

  test('should have distinct styling for delete action button', async ({ page }) => {
    await expandLibrariesSection(page);

    const firstLibrary = page.locator('.library-item').first();
    await firstLibrary.hover();
    await firstLibrary.locator('.delete-button-small').click();
    await page.waitForSelector('[role="alertdialog"]');

    const deleteActionButton = page.locator('[role="alertdialog"]').getByRole('button', { name: 'Delete' });

    // Should have red background (delete-action class)
    await expect(deleteActionButton).toHaveCSS('background-color', 'rgb(220, 53, 69)'); // #dc3545
    await expect(deleteActionButton).toHaveCSS('color', 'rgb(255, 255, 255)'); // white
  });
});
