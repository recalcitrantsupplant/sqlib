import { test, expect, type Page } from '@playwright/test';
import {
  assignQueryVersionToGroupCanvas,
  bootstrapQueryGroupCanvas,
  createQueryVersionWithCode,
  openCanvasEditorTab,
  QUERY_NODE_ID,
  selectQueryNode,
} from './query-group-test-helpers';

/*
 * The node card's header controls and the Editor tab's way out to the query.
 *
 * Set NODE_CONTROLS_SHOTS to a directory to also write the screenshots the pull
 * request shows, in light and dark.
 */

const QUERY_NAME = 'Lines through a station';
const QUERY_TEXT = 'SELECT ?line ?station WHERE { ?line <http://example.org/stopsAt> ?station } LIMIT 10';
const SHOTS = process.env.NODE_CONTROLS_SHOTS ?? '';

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function prepare(page: Page) {
  await bootstrapQueryGroupCanvas(page);
  await createQueryVersionWithCode(page, QUERY_NAME, QUERY_TEXT);
  await assignQueryVersionToGroupCanvas(page, QUERY_NAME);
  return page.locator(`.vue-flow__node[data-id="${QUERY_NODE_ID}"]`);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`query group node controls (${colorScheme})`, () => {
    test.use({ colorScheme, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

    test('the card discloses with an icon, peeks at its query, and the run bar names no backend', async ({ page }) => {
      const node = await prepare(page);

      await expect(page.getByTestId('run-bar-backend')).toHaveCount(0);

      const disclosure = node.getByTestId('node-disclosure');
      await expect(disclosure.locator('svg')).toBeVisible();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

      await node.getByTestId('node-peek').hover();
      const panel = page.getByTestId('node-peek-panel');
      await expect(panel).toBeVisible();
      await expect(panel.locator('.cm-content')).toContainText('?station');
      await expect(panel.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
      await shoot(page, `peek-${colorScheme}`);

      // Leaving the button and the panel closes an unpinned peek.
      await page.mouse.move(5, 5);
      await expect(panel).toBeHidden();

      // A click pins it; a second click closes it.
      await node.getByTestId('node-peek').click();
      await page.mouse.move(5, 5);
      await page.waitForTimeout(400);
      await expect(panel).toBeVisible();
      await node.getByTestId('node-peek').click();
      await expect(panel).toBeHidden();

      await disclosure.click();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await expect(node.locator('.node-details')).toBeVisible();
      await shoot(page, `card-open-${colorScheme}`);
    });

    test('the Editor tab opens the node query on the Queries page', async ({ page }) => {
      await prepare(page);
      // Saving the group clears the selection, so pick the node again.
      await selectQueryNode(page, QUERY_NODE_ID);
      await openCanvasEditorTab(page);
      const link = page.getByTestId('node-open-query');
      await expect(link).toBeVisible();
      await shoot(page, `editor-link-${colorScheme}`);

      await link.click();
      await expect(page).toHaveURL(/\/queries\//);
      await expect(page.locator('.query-work-area .cm-content').first()).toContainText('?station');
    });
  });
}
