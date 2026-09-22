/**
 * Baseline mocks for the seven collection endpoints the sidebar loads.
 *
 * A screen loads its collections together, so ONE unmocked endpoint rejects
 * the whole batch and the list renders empty. Several specs predate the rules
 * suite and mocked only the first four, which is why they stopped finding
 * libraries — the symptom looked like a selector problem and was actually a
 * missing route.
 *
 * Call this first in `beforeEach`, then register any spec-specific routes
 * after it: Playwright matches the most recently registered handler first, so
 * a later `page.route('**\/libraries*', ...)` still wins.
 */
import type { Page, Route } from '@playwright/test';

export type Collections = {
  libraries?: unknown[];
  backends?: unknown[];
  queries?: unknown[];
  queryGroups?: unknown[];
  rules?: unknown[];
  dataBlocks?: unknown[];
  ruleSets?: unknown[];
};

const PATHS: Array<[keyof Collections, string]> = [
  ['libraries', '**/libraries'],
  ['backends', '**/backends'],
  ['queries', '**/queries'],
  ['queryGroups', '**/query-groups'],
  ['rules', '**/rules'],
  ['dataBlocks', '**/data-blocks'],
  ['ruleSets', '**/rule-sets'],
];

export async function mockSidebarCollections(page: Page, collections: Collections = {}) {
  /*
   * `/health` as well, because the SPA reads the deployment's mode from it and
   * hides what a read-only deployment would refuse — New library among them.
   * Unmocked, the answer comes from whatever API happens to be running on the
   * developer's machine, and a spec that clicks New library passes or fails on
   * that. Read-only is a mode a spec should ask for, not inherit.
   */
  await page.route('**/health', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', auth: { mode: 'disabled' }, readOnly: false }),
    });
  });

  for (const [key, pattern] of PATHS) {
    const body = JSON.stringify(collections[key] ?? []);
    await page.route(pattern, async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    });
  }
}
