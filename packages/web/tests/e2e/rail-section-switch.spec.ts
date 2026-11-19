import { test, expect, type Page, type Route } from '@playwright/test';
import { mockEntityApi, LIBRARY, QUERY, QUERY_GROUP, RULE_SET } from './fixtures/entities';

/**
 * A click on the rail opens a record of the section clicked.
 *
 * The rail's saved rows come from one paging instance that serves every
 * section. It once answered the next section's first read with the rows of
 * the section just left, so Graphs → Query opened the data graph "Pantry" in
 * the query editor, at `/queries/<data graph id>`.
 */

const DATA_GRAPH = {
  id: 'urn:sqlib:data-graph:pantry',
  name: 'Pantry',
  description: null,
  currentVersion: 'urn:sqlib:data-graph-version:pantry-v1',
  currentVersionNumber: 1,
  isPartOf: [LIBRARY.id],
  dateCreated: '2026-01-01T00:00:00Z',
  dateModified: '2026-01-02T00:00:00Z',
};

const DATA_GRAPH_VERSION = {
  id: DATA_GRAPH.currentVersion,
  isPartOf: DATA_GRAPH.id,
  version: 1,
  contentString: '<urn:x:a> <urn:x:b> <urn:x:c> .',
  contentFormat: 'text/turtle',
  dateCreated: '2026-01-01T00:00:00Z',
};

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const CASES = [
  { from: 'dataGraphs', fromId: DATA_GRAPH.id, to: 'queries', label: 'Query', toId: QUERY.id },
  { from: 'queries', fromId: QUERY.id, to: 'dataGraphs', label: 'Graphs', toId: DATA_GRAPH.id },
  { from: 'rules', fromId: RULE_SET.id, to: 'queryGroups', label: 'Groups', toId: QUERY_GROUP.id },
];

async function trackPaths(page: Page): Promise<string[]> {
  const paths: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) paths.push(decodeURIComponent(new URL(frame.url()).pathname));
  });
  return paths;
}

test.describe('Rail section switch', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page, {
      extraRoutes: [
        [/\/data-graphs\/[^/]+\/versions\/[^/]+$/, (route) => json(route, DATA_GRAPH_VERSION)],
        [/\/data-graphs\/[^/]+\/versions$/, (route) => json(route, [DATA_GRAPH_VERSION])],
        [/\/data-graphs\/[^/]+$/, (route) => json(route, DATA_GRAPH)],
        [/\/data-graphs$/, (route) => json(route, [DATA_GRAPH])],
      ],
    });
  });

  for (const { from, fromId, to, label, toId } of CASES) {
    test(`${from} → ${to} opens a record of ${to}`, async ({ page }) => {
      const paths = await trackPaths(page);
      await page.goto(`/${from}`, { waitUntil: 'domcontentloaded' });
      await page.locator(`[data-entity-id="${fromId}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/${from}/${encodeURIComponent(fromId)}`));

      await page.locator('.nav-rail .rail-button').filter({ hasText: label }).first().click();
      await expect(page).toHaveURL(new RegExp(`/${to}/${encodeURIComponent(toId)}`));
      expect(paths).not.toContain(`/${to}/${fromId}`);
    });
  }
});
