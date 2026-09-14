import { test, expect } from '@playwright/test';
import {
  assignQueryVersionToGroupCanvas,
  bootstrapQueryGroupCanvas,
  createQueryVersionWithCode,
  LIBRARY_NAME,
  GROUP_NAME,
  QUERY_NODE_ID,
  openCanvasEditorTab,
  selectQueryNode,
  selectSidebarQueryGroup,
} from './query-group-test-helpers';

const REFRESH_QUERY_NAME = 'Canvas Refresh Query';
const REFRESH_QUERY_STRING = 'SELECT ?city WHERE { ?city wdt:P31 wd:Q515 } LIMIT 7';

/*
 * Revived (#47 item 4) along with `query-group-execution-mocked.spec.ts`, which
 * carries the note on what had drifted: saving is one `SaveBar` button now, and
 * a click at a node's centre hits its `.node-toggle` (which stops propagation)
 * rather than selecting it, so `selectQueryNode` clicks clear of the toggle.
 */
test.describe('Query group canvas persistence', () => {
  test('assigned query label survives a page refresh', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await createQueryVersionWithCode(page, REFRESH_QUERY_NAME, REFRESH_QUERY_STRING);
    await assignQueryVersionToGroupCanvas(page, REFRESH_QUERY_NAME);

    await page.reload();
    await page.waitForLoadState('networkidle');

    await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
    await page.locator('.vue-flow__node').first().waitFor();
    await openCanvasEditorTab(page);
    await selectQueryNode(page, QUERY_NODE_ID);

    await expect(page.locator(`[data-id="${QUERY_NODE_ID}"]`)).toContainText(REFRESH_QUERY_NAME);
    // The object editor's "Assigned query" field, which is where the reloaded
    // group's iriMap has to have survived for the name to resolve at all.
    const assignedQuery = page.locator('.canvas-editor .field').filter({ hasText: /assigned query/i }).first();
    await expect(assignedQuery).toContainText(REFRESH_QUERY_NAME);
  });
});
