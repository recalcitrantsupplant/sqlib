/**
 * The results table reaches the right edge of its panel after a column is
 * resized, and the dragged column keeps the width it was dragged to.
 *
 * Before, a dragged column switched the table to the sum of its column widths,
 * so the table stopped short of the panel and left an empty band on the right.
 */
import { test, expect, type Route } from './fixtures/test';
import { mockSidebarCollections } from './fixtures/collections';
import { API_HOST } from './api-origin';

const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';

const RESULT = {
  head: { vars: ['graph', 'triples'] },
  results: {
    bindings: [
      {
        graph: { type: 'uri', value: 'https://example.org/graph/rail-operations' },
        triples: { type: 'literal', value: '8', datatype: XSD_INTEGER },
      },
      {
        graph: { type: 'uri', value: 'https://example.org/graph/timetable' },
        triples: { type: 'literal', value: '24', datatype: XSD_INTEGER },
      },
    ],
  },
};

test('keeps the results table at the panel edge after a column resize', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await mockSidebarCollections(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('sparql-query-lib-scratch-migrated', '2026-08-06T00:00:00Z');
  });
  await page.route(`**//${API_HOST}/sparql`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/sparql-results+json',
      body: JSON.stringify(RESULT),
    }));

  await page.goto('/?section=queries', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('section-overview-new').click();
  await page.locator('.cm-content').first().click();
  await page.keyboard.type('SELECT ?graph ?triples WHERE { ?s ?p ?o }');
  // Past the 500 ms autosave debounce, which renders the results panel again.
  await page.waitForTimeout(700);
  await page.getByTestId('run-bar-backend').click();
  await page.getByRole('option').filter({ hasText: /ephemeral/i }).first().click();
  await page.getByTestId('run-bar-run').click();

  const scroll = page.locator('.table-scroll').first();
  const table = scroll.locator('table');
  await expect(table).toBeVisible();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(500);

  const handle = page.getByTestId('column-resize-triples');
  const header = page.locator('th', { has: handle });
  const before = (await handle.boundingBox())!;
  const widthBefore = (await header.boundingBox())!.width;
  await page.mouse.move(before.x + 3, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x - 37, before.y + before.height / 2, { steps: 5 });
  await page.mouse.up();

  const widthAfter = (await header.boundingBox())!.width;
  expect(Math.abs(widthAfter - (widthBefore - 40))).toBeLessThanOrEqual(1);

  // The scroll box reserves a scrollbar gutter on each side; the table fills
  // the width between them.
  const gutter = await scroll.evaluate((element) => (element.offsetWidth - element.clientWidth) / 2);
  const scrollBox = (await scroll.boundingBox())!;
  const tableBox = (await table.boundingBox())!;
  expect(tableBox.x + tableBox.width).toBeGreaterThanOrEqual(scrollBox.x + scrollBox.width - gutter - 1);
});
