import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';
import { openSplash, openSplashLibraries } from './navigate';

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

    await openSplash(page);
    // The rows live behind the Libraries card now: a deployment has a handful
    // of libraries and the landing screen leads with the grid, so the list
    // opens from its card rather than sitting above everything else.
    await openSplashLibraries(page);
  });

  /*
   * Deleting a library is done from its row on the splash screen, which is
   * where the affordance landed when the artifact tree was removed. Two tests
   * went with the tree rather than moving: the delete button is drawn rather
   * than revealed on hover, so there is no opacity to assert, and there is no
   * library row to expand.
   */
  const rows = (page: Page) => page.locator('.library-row');

  test('should open confirmation dialog when clicking delete', async ({ page }) => {
    const firstLibrary = rows(page).first();
    const libraryName = await firstLibrary.locator('.library-name').textContent();

    await firstLibrary.locator('.row-action--danger').click();
    await page.waitForSelector('[role="alertdialog"]');

    await expect(page.getByRole('heading', { name: 'Delete Library?' })).toBeVisible();
    await expect(page.getByText(`Are you sure you want to delete "${libraryName!.trim()}"`)).toBeVisible();
    await expect(page.getByText('This action cannot be undone')).toBeVisible();
  });

  test('should have Cancel and Delete buttons in confirmation dialog', async ({ page }) => {
    await rows(page).first().locator('.row-action--danger').click();
    await page.waitForSelector('[role="alertdialog"]');

    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  test('should close confirmation dialog when clicking Cancel', async ({ page }) => {
    const firstLibrary = rows(page).first();
    const libraryName = (await firstLibrary.locator('.library-name').textContent())!.trim();

    await firstLibrary.locator('.row-action--danger').click();
    await page.waitForSelector('[role="alertdialog"]');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('[role="alertdialog"]')).not.toBeVisible();
    await expect(rows(page).filter({ hasText: libraryName })).toHaveCount(1);
  });

  test('should delete library when confirming', async ({ page }) => {
    const initialCount = await rows(page).count();
    const firstLibrary = rows(page).first();
    const libraryName = (await firstLibrary.locator('.library-name').textContent())!.trim();

    await firstLibrary.locator('.row-action--danger').click();
    await page.waitForSelector('[role="alertdialog"]');
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.locator('[role="alertdialog"]')).not.toBeVisible();
    await expect(rows(page)).toHaveCount(initialCount - 1);
    await expect(rows(page).filter({ hasText: libraryName })).toHaveCount(0);
  });

  test('should delete correct library when multiple exist', async ({ page }) => {
    const libraryCount = await rows(page).count();
    expect(libraryCount).toBeGreaterThan(1);

    const secondLibrary = rows(page).nth(1);
    const secondLibraryName = (await secondLibrary.locator('.library-name').textContent())!.trim();
    const firstLibraryName = (await rows(page).first().locator('.library-name').textContent())!.trim();

    await secondLibrary.locator('.row-action--danger').click();
    await page.waitForSelector('[role="alertdialog"]');
    await expect(page.getByText(`"${secondLibraryName}"`)).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(rows(page)).toHaveCount(libraryCount - 1);
    await expect(rows(page).filter({ hasText: firstLibraryName })).toHaveCount(1);
  });

  test('should not trigger delete when clicking the library name', async ({ page }) => {
    await rows(page).first().locator('.library-open').click();
    await expect(page.locator('[role="alertdialog"]')).not.toBeVisible();
  });

  test('should close dialog when pressing ESC key', async ({ page }) => {
    await rows(page).first().locator('.row-action--danger').click();
    await page.waitForSelector('[role="alertdialog"]');

    await page.keyboard.press('Escape');
    await expect(page.locator('[role="alertdialog"]')).not.toBeVisible();
  });

  test('should have distinct styling for delete action button', async ({ page }) => {
    await rows(page).first().locator('.row-action--danger').click();
    await page.waitForSelector('[role="alertdialog"]');

    const deleteActionButton = page.locator('[role="alertdialog"]').getByRole('button', { name: 'Delete' });
    await expect(deleteActionButton).toHaveCSS('background-color', 'rgb(220, 53, 69)'); // #dc3545
    await expect(deleteActionButton).toHaveCSS('color', 'rgb(255, 255, 255)'); // white
  });
});
