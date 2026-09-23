import { test, expect } from '@playwright/test';
import { mockEntityApi } from './fixtures/entities';
import { WEB_BASE_URL } from './web-port';

test.describe('Smoke Tests', () => {
  // Without mocks every API call fails CORS against an API that is not running,
  // so the "no console errors" check was asserting against 30-odd fetch failures.
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page);
  });

  test('should load the main page without errors', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait for the app to render, rather than for the network to fall idle.
    await expect(page.locator('.app-layout').first()).toBeVisible();

    // Check that we're on a valid page (not a 404 or error page)
    const url = page.url();
    expect(url).toContain(new URL(WEB_BASE_URL).host);
  });

  test('should display the sidebar', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Check that layout exists
    const layout = page.locator('.app-layout').first();
    await expect(layout).toBeVisible();
  });

  test('should not have console errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-layout').first()).toBeVisible();

    // Allow some time for any async errors
    await page.waitForTimeout(1000);

    // Check if there are any console errors (excluding known warnings)
    const criticalErrors = consoleErrors.filter(
      err => !err.includes('Warning') && !err.includes('[Vue warn]')
    );

    if (criticalErrors.length > 0) {
      console.log('Console errors found:', criticalErrors);
    }

    expect(criticalErrors).toHaveLength(0);
  });
});
