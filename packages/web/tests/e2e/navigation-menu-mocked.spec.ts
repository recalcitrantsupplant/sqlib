import { test, expect, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';

const mockBackends = [
  {
    id: 'urn:sqlib:backend:test-1',
    name: 'Test Backend',
    description: 'HTTP SPARQL backend',
    backendType: 'http',
    endpoint: 'http://localhost:7878/sparql',
  },
];

const mockLibraries = [
  {
    id: 'urn:sqlib:library:test-lib-1',
    name: 'Test Library',
    description: 'A test library',
  },
];

const mockQueries = [
  {
    id: 'urn:sqlib:query:test-query-1',
    name: 'Test Query',
    description: 'A test query for navigation',
    currentVersion: null,
    defaultBackend: null,
    isPartOf: ['urn:sqlib:library:test-lib-1'],
    dateCreated: new Date().toISOString(),
    dateModified: new Date().toISOString(),
  },
];

const mockQueryGroups: any[] = [];
const mockRules: any[] = [];
const mockDataBlocks: any[] = [];
const mockRuleSets: any[] = [];

test.describe('Navigation Menu (Mocked)', () => {
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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockLibraries),
      });
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

    await page.route('**/rules', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockRules),
      });
    });

    await page.route('**/data-blocks', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockDataBlocks),
      });
    });

    await page.route('**/rule-sets', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockRuleSets),
      });
    });

    // Navigate to main page
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display navigation sidebar', async ({ page }) => {
    const sidebar = page.locator('.nav-sidebar');
    await expect(sidebar).toBeVisible();

    // Check for main title
    await expect(page.getByText('SPARQL Query Library')).toBeVisible();
  });

  test('should display Libraries section', async ({ page }) => {
    const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });
    await expect(librariesSection).toBeVisible();
  });

  test('should display Backends section', async ({ page }) => {
    const backendsSection = page.locator('.section-header').filter({ hasText: 'Backends' });
    await expect(backendsSection).toBeVisible();
  });

  test('should toggle Libraries section when clicked', async ({ page }) => {
    const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });
    const sectionToggle = librariesSection.locator('.section-toggle');

    // Libraries section should be expanded by default
    const librariesContent = page.locator('.nav-section').filter({ has: librariesSection }).locator('.section-content');
    await expect(librariesContent).toBeVisible();

    // Click to collapse
    await sectionToggle.click();
    await expect(librariesContent).not.toBeVisible();

    // Click to expand again
    await sectionToggle.click();
    await expect(librariesContent).toBeVisible();
  });

  test('should toggle Backends section when clicked', async ({ page }) => {
    const backendsSection = page.locator('.section-header').filter({ hasText: 'Backends' });
    const sectionToggle = backendsSection.locator('.section-toggle');

    // Backends section should be expanded by default
    const backendsContent = page.locator('.nav-section').filter({ has: backendsSection }).locator('.section-content');
    await expect(backendsContent).toBeVisible();

    // Click to collapse
    await sectionToggle.click();
    await expect(backendsContent).not.toBeVisible();

    // Click to expand again
    await sectionToggle.click();
    await expect(backendsContent).toBeVisible();
  });

  test('should display test library in navigation', async ({ page }) => {
    await expect(page.getByText('Test Library')).toBeVisible();
  });

  test('should display test backend in navigation', async ({ page }) => {
    await expect(page.getByText('Test Backend')).toBeVisible();
  });

  test('should expand library when clicked', async ({ page }) => {
    const libraryToggle = page.locator('.library-toggle').filter({ hasText: 'Test Library' });
    await libraryToggle.click();

    // Should show subcategories
    await expect(page.locator('.category-header').filter({ hasText: 'Queries' })).toBeVisible();
    await expect(page.locator('.category-header').filter({ hasText: 'Query Groups' })).toBeVisible();
    // Rule sets, not "Rules & Data Blocks": a rule set is the smallest thing
    // the tree can open, so there is no category for its parts.
    await expect(page.locator('.category-header').filter({ hasText: 'Rule Sets' })).toBeVisible();
  });

  test('should expand Queries category and show test query', async ({ page }) => {
    // First expand the library
    const libraryToggle = page.locator('.library-toggle').filter({ hasText: 'Test Library' });
    await libraryToggle.click();
    await page.waitForTimeout(200);

    // Then expand Queries category
    const queriesCategory = page.locator('.category-header').filter({ hasText: 'Queries' }).first();
    await queriesCategory.click();
    await page.waitForTimeout(200);

    // Should show the test query
    await expect(page.locator('.item-button').filter({ hasText: 'Test Query' })).toBeVisible();
  });

  test('should show add buttons on hover', async ({ page }) => {
    const librariesSection = page.locator('.section-header').filter({ hasText: 'Libraries' });

    // Hover over section header
    await librariesSection.hover();

    // Add button should be visible
    const addButton = librariesSection.locator('.add-button');
    await expect(addButton).toBeVisible();
  });

  test('should collapse sidebar when toggle clicked', async ({ page }) => {
    const collapseToggle = page.locator('.collapse-toggle');
    await collapseToggle.click();

    // Sidebar should have collapsed class
    const sidebar = page.locator('.nav-sidebar');
    await expect(sidebar).toHaveClass(/collapsed/);

    // Title should be hidden
    await expect(page.getByText('SPARQL Query Library')).not.toBeVisible();
  });

  test('should expand sidebar when toggle clicked again', async ({ page }) => {
    const collapseToggle = page.locator('.collapse-toggle');

    // First collapse
    await collapseToggle.click();
    await page.waitForTimeout(300);

    // Then expand
    await collapseToggle.click();
    await page.waitForTimeout(300);

    // Sidebar should not have collapsed class
    const sidebar = page.locator('.nav-sidebar');
    await expect(sidebar).not.toHaveClass(/collapsed/);

    // Title should be visible
    await expect(page.getByText('SPARQL Query Library')).toBeVisible();
  });
});