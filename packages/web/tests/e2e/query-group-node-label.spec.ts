import { test, expect, type Page } from '@playwright/test';
import {
  EXISTING_QUERY_NAME,
  GROUP_NAME,
  LIBRARY_NAME,
  QUERY_NODE_ID,
  bootstrapQueryGroupCanvas,
  openCanvasEditorTab,
  saveQueryGroupNewVersion,
  selectQueryNode,
  selectSidebarQueryGroup,
} from './query-group-test-helpers';

/*
 * The inspector's "Display label" field, and whether it does anything.
 *
 * It has been on the Editor tab as long as the editor has, and until now it
 * changed nothing an author could see: the card derived its own title from the
 * attached query and then from the node's kind, so a renamed node went on
 * reading "Query Node" on the graph — and the name was dropped at the next
 * save regardless, because nothing wrote it anywhere.
 *
 * So these drive the field the way a person does: type a name, look at the
 * canvas, save, and come back to it.
 */

const openGroupCanvas = async (page: Page) => {
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
  await page.locator('.vue-flow__node').first().waitFor();
  await openCanvasEditorTab(page);
};

const cardTitle = (page: Page) => page.locator(`.vue-flow__node[data-id="${QUERY_NODE_ID}"] .node-kind`);

/** The POST that creates the next group version, with the draft as its body. */
const versionCreateRequest = (page: Page) =>
  page.waitForRequest(
    (request) => request.method() === 'POST' && /\/query-groups\/[^/]+\/v$/.test(new URL(request.url()).pathname),
  );

test.describe('Query group node display label (mocked)', () => {
  test('renaming a node renames its card, and the query keeps its own name', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await selectQueryNode(page, QUERY_NODE_ID);

    // Before anybody names it, the card is the query it runs.
    await expect(cardTitle(page)).toHaveText(EXISTING_QUERY_NAME);

    await page.locator('#node-label-input').fill('Step one');

    await expect(cardTitle(page)).toHaveText('Step one');
    /*
     * The query is still named where the node says what it is attached to —
     * renaming the step is not renaming the query, and a card that hid which
     * query it runs would have traded one invisible fact for another.
     */
    await page.locator(`.vue-flow__node[data-id="${QUERY_NODE_ID}"] .node-toggle`).click();
    await expect(page.locator(`.vue-flow__node[data-id="${QUERY_NODE_ID}"] .node-name-value`)).toHaveText(
      EXISTING_QUERY_NAME,
    );
  });

  test('clearing the name puts the query back on the card', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await selectQueryNode(page, QUERY_NODE_ID);

    await page.locator('#node-label-input').fill('Step one');
    await expect(cardTitle(page)).toHaveText('Step one');

    // Emptying the field is how an author says "no name of my own", so the card
    // goes back to naming what the node runs rather than keeping a blank title.
    await page.locator('#node-label-input').fill('');
    await expect(cardTitle(page)).toHaveText(EXISTING_QUERY_NAME);
  });

  test('the name is written into the canvas snapshot, and survives the save', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await selectQueryNode(page, QUERY_NODE_ID);
    await page.locator('#node-label-input').fill('Step one');

    /*
     * Wait for the name to reach the graph before saving it, which is what the
     * two tests above do and this one did not. `fill` returns once the input
     * has the value and the `@input` handler has been called; the card reads
     * the node data that handler updates, and the snapshot below is serialised
     * from that same state — so a card still reading the query's name means the
     * save captures a node with no label. Observed passing on CI and then
     * failing on the re-run of the same commit, the opposite way round from the
     * flake in `library-backend-edit.spec.ts` on the same two runs.
     */
    await expect(cardTitle(page)).toHaveText('Step one');

    const request = versionCreateRequest(page);
    await saveQueryGroupNewVersion(page);
    const payload = (await request).postDataJSON();

    /*
     * In `canvasData` rather than on the node, because the execution-node
     * contract is `.strict()` and has no field for a display name — and because
     * a name is the same kind of fact as a position: how this canvas is drawn.
     */
    const snapshot = JSON.parse(payload.queryGroupVersion.canvasData);
    const saved = snapshot.nodes.find((node: { id: string }) => node.id === QUERY_NODE_ID);
    expect(saved.label).toBe('Step one');

    /*
     * Wait for the save to land before reading anything back. `saveWorkAreaVersion`
     * only clicks the button, and the request awaited above is the POST going
     * out rather than the reload coming back, so both assertions below were
     * racing the canvas being rebuilt from the new version. The version pill is
     * how the rest of the suite waits for a group save to settle — see
     * `assignQueryVersionToGroupCanvas`.
     */
    await expect(page.locator('.querygroup-work-area [data-testid="version-pill"]')).toContainText('v2');

    // And the version the save writes comes back naming it, rather than the
    // canvas reverting to the query's name the moment it reloads.
    await expect(cardTitle(page)).toHaveText('Step one');

    /*
     * Reopened rather than read off the panel that was already on screen.
     *
     * On CI this line failed with `#node-label-input` absent for its full five
     * seconds while the card assertion above it passed — so the name had
     * survived the save and the *inspector* was what had gone. Which of the two
     * mechanisms dropped it is not pinned down: a save rebuilds the canvas from
     * the reloaded version, and the Editor tab is only ever opened by a
     * `setTimeout` in `showEditorTab`, so either the selection or the tab could
     * be the one that does not survive. Re-selecting re-establishes both, which
     * is what a person does, and it asserts the stronger thing: the name came
     * back with the saved version rather than lingering in a panel nothing had
     * refreshed. If the selection *should* survive a save, that is a product
     * question worth its own change rather than something for this test to pin
     * by accident.
     */
    await selectQueryNode(page, QUERY_NODE_ID);
    await openCanvasEditorTab(page);
    await expect(page.locator('#node-label-input')).toHaveValue('Step one');
  });
});
