import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';
import { API_HOST } from './api-origin';

/**
 * Popping an editor out over the page, and running it from in there.
 *
 * The pop-out is CSS rather than a second editor: the region fixes itself over
 * the viewport where it already stands, so what is asserted here is that the
 * *same* editor and the *same* run strip are the ones on screen — the text
 * survives the trip, the strip moves rather than being duplicated, and a run
 * started from inside the pop-out is the ordinary run.
 */

const LIBRARY = {
  id: 'urn:sqlib:library:test-1',
  name: 'Test Library',
  description: 'A test library',
  defaultBackend: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const QUERY_TEXT = 'SELECT ?s WHERE { ?s ?p ?o }';

const expandButton = (page: Page) => page.locator('[data-testid="sparql-editor-expand"]');
const region = (page: Page) => page.locator('[data-testid="query-editor-expand"]');
const runBar = (page: Page) => page.locator('[data-testid="run-bar"]');

async function typeQuery(page: Page, text: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await expect(editor).toContainText(text.slice(0, 20));
}

test.describe('Expanding an editor', () => {
  test.beforeEach(async ({ page }) => {
    await mockSidebarCollections(page, { libraries: [LIBRARY] });
    await page.addInitScript(() => {
      window.localStorage.setItem('sparql-query-lib-scratch-migrated', '2026-08-06T00:00:00Z');
    });
    await page.goto('/?section=queries', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="entity-list-sidebar"]');
    await page.getByTestId('section-overview-new').click();
    await typeQuery(page, QUERY_TEXT);
  });

  test('takes the editor and its run strip over the page, and gives them back', async ({ page }) => {
    const viewport = page.viewportSize()!;

    // Collapsed, the region draws no box at all: `display: contents`.
    await expect(region(page)).not.toHaveClass(/expanded/);
    const inlineEditorWidth = (await page.locator('.cm-editor').first().boundingBox())!.width;
    expect(inlineEditorWidth).toBeLessThan(viewport.width * 0.75);

    await expandButton(page).click();

    await expect(region(page)).toHaveAttribute('role', 'dialog');
    const popped = (await region(page).boundingBox())!;
    expect(popped.width).toBeGreaterThan(viewport.width * 0.85);
    expect(popped.height).toBeGreaterThan(viewport.height * 0.85);

    // The run strip came with it — one of it, inside the pop-out.
    await expect(runBar(page)).toHaveCount(1);
    await expect(region(page).locator('.expand-run [data-testid="run-bar"]')).toBeVisible();

    // The same editor, with the same text in it.
    await expect(page.locator('.cm-content')).toContainText(QUERY_TEXT);
    const poppedEditorWidth = (await page.locator('.cm-editor').first().boundingBox())!.width;
    expect(poppedEditorWidth).toBeGreaterThan(inlineEditorWidth);

    await page.keyboard.press('Escape');

    await expect(region(page)).not.toHaveClass(/expanded/);
    await expect(runBar(page)).toHaveCount(1);
    await expect(page.locator('.cm-content')).toContainText(QUERY_TEXT);
    await expect(expandButton(page)).toBeVisible();
  });

  test('runs from inside the pop-out', async ({ page }) => {
    let executed: string | null = null;
    await page.route(`**//${API_HOST}/sparql`, async (route: Route) => {
      executed = route.request().postDataJSON()?.query ?? null;
      await route.fulfill({
        status: 200,
        contentType: 'application/sparql-results+json',
        body: JSON.stringify({ head: { vars: ['s'] }, results: { bindings: [] } }),
      });
    });

    await page.locator('[data-testid="run-bar-backend"]').click();
    await page.getByRole('option').filter({ hasText: /ephemeral/i }).first().click();

    await expandButton(page).click();
    await expect(region(page)).toHaveClass(/expanded/);

    await page.locator('[data-testid="run-bar-run"]').click();

    await expect.poll(() => executed).toContain('SELECT');

    // The pop-out covers the results tab, so a run swaps the editor for the
    // popped-out results.
    await expect(region(page)).not.toHaveClass(/expanded/);
    await expect(page.locator('[data-testid="results-focus"]')).toBeVisible();
  });

  test('closes itself to show the arguments it was asked for', async ({ page }) => {
    await expandButton(page).click();
    await expect(region(page)).toHaveClass(/expanded/);

    // The pickers on the strip open panels the pop-out is covering, so asking
    // for one closes the pop-out rather than switching a hidden tab.
    await page.locator('[data-testid="run-bar-arguments"]').click();

    await expect(region(page)).not.toHaveClass(/expanded/);
    await expect(page.locator('[data-testid="arguments-tab"]')).toHaveClass(/active/);
  });
});

test.describe('Expanding an editor with no background of its own', () => {
  /*
   * The ETL template editor paints no background. The pop-out's dim is a
   * child of the region at `z-index: -1`, so before the fix it showed through
   * the editor, and the template read as dark grey with the syntax colours on
   * top of it.
   */
  for (const scheme of ['light', 'dark'] as const) {
    test(`shows the ETL template on the page surface (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockSidebarCollections(page, { libraries: [LIBRARY] });
      await page.goto('/?section=etl', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'New' }).first().click();
      await page.getByTestId('etl-template-expand-button').click();
      const etlRegion = page.getByTestId('etl-template-expand');
      await expect(etlRegion).toHaveClass(/expanded/);

      // A pixel of the editor's empty area, as drawn, against the surface colour.
      const box = (await page.locator('.sparql-section .cm-content').boundingBox())!;
      const shot = await page.screenshot({
        clip: { x: box.x + box.width - 40, y: box.y + 2, width: 1, height: 1 },
      });
      const drawn = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      }, shot.toString('base64'));
      const surface = await etlRegion.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(drawn).toBe(surface);
    });
  }
});
