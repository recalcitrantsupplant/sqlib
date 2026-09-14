/**
 * Baseline mocks for the seven collection endpoints the sidebar loads.
 *
 * `NavigationSidebar.loadLibrariesData` fetches libraries, queries, query
 * groups, rules, data blocks and rule sets inside a single `Promise.all`, so
 * ONE unmocked endpoint rejects the whole thing and the sidebar renders empty.
 * Several specs predate the rules suite and mocked only the first four, which
 * is why they stopped finding libraries — the symptom looked like a selector
 * problem and was actually a missing route.
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
