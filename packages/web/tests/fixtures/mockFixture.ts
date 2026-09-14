import { test as base } from '@playwright/test';

export const test = base.extend({
  context: async ({ context }, use) => {
    // Initialize MSW in the browser context
    await context.addInitScript(() => {
      // This will be injected into every page
      (window as any).__MSW_ENABLED__ = true;
    });

    // Route all API requests through MSW
    await context.route('/api/**', async (route) => {
      // Let MSW handle it
      await route.continue();
    });

    await use(context);
  },

  page: async ({ page }, use) => {
    // Add MSW setup script before each test
    await page.addInitScript(() => {
      // Flag to indicate we're in mock mode
      (window as any).__USE_MOCKS__ = true;
    });

    await use(page);
  },
});

export { expect } from '@playwright/test';
