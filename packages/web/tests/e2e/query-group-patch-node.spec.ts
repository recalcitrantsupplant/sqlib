import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapQueryGroupCanvas,
  BACKEND_ID,
  END_NODE_ID,
  EXISTING_QUERY_NAME,
  GROUP_NAME,
  LIBRARY_NAME,
  QUERY_NODE_ID,
  RULE_SET_NAME,
  UPDATE_QUERY_NAME,
  UPDATE_QUERY_VERSION_ID,
  chooseQueryInInspector,
  connectNodes,
  moveNodeBy,
  openCanvasEditorTab,
  saveQueryGroupNewVersion,
  selectSidebarQueryGroup,
  settledHandleCentre,
} from './query-group-test-helpers';

/*
 * The patch node flow (#290, the canvas half).
 *
 * A `PatchNode` is the fourth kind of execution node and the only one that runs
 * nothing: it names an update, derives what that update *would* change, and
 * emits the two halves of the answer on separate RDF ports. The API half
 * shipped without a canvas, which left the browser as exactly the client the
 * writer guard was written about — it read a node with a `queryId`, drew it as
 * a query node, and sent it back as one.
 *
 * So these specs are about the difference the canvas knowing the type makes:
 * the node is drawn as itself, its two halves are minted with it and named, an
 * assignment is refused unless it is an update, and the save carries the type
 * and both halves back.
 *
 * The node is authored rather than seeded, for the same reason the ruleset
 * specs author theirs: the toolbar, the assignment and the ports are the paths
 * that have never run.
 */

const openGroupCanvas = async (page: Page) => {
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
  await page.locator('.vue-flow__node').first().waitFor();
  await openCanvasEditorTab(page);
};

const editor = (page: Page) => page.locator('.canvas-editor');
const toasts = (page: Page) => page.locator('[data-sonner-toaster]');

/** A node the canvas has just minted, before any save gives it a real IRI. */
const draftNode = (page: Page) => page.locator('.vue-flow__node[data-id^="urn:ui-temp:node-"]');

/** The POST that creates the next group version, with the draft as its body. */
const versionCreateRequest = (page: Page) =>
  page.waitForRequest(
    (request) => request.method() === 'POST' && /\/query-groups\/[^/]+\/v$/.test(new URL(request.url()).pathname),
  );

/**
 * Add a patch node and select it.
 *
 * Selected through the node's top-left corner: a collapsed node is almost
 * entirely its own toggle button, which carries `@click.stop`, so a click at the
 * centre opens the node and never reaches `@node-click`.
 */
const addPatchNode = async (page: Page) => {
  await page.locator('.add-node-toolbar button[title^="Add Patch Node"]').click();
  const node = draftNode(page);
  await expect(node).toHaveCount(1);
  await node.click({ position: { x: 3, y: 3 } });
  await expect(node).toHaveClass(/selected/);
  return node;
};

const assignQuery = async (page: Page, queryName: string) => {
  await chooseQueryInInspector(page, queryName);
};

/**
 * Draw an edge without requiring one to appear.
 *
 * `connectNodes` waits for the inspector to name the new edge, which is right
 * when the connection is expected to be made and useless when the point is that
 * it is refused. Same drag, no assertion about the outcome.
 */
const dragConnect = async (page: Page, sourceNodeId: string, targetNodeId: string) => {
  const end = await settledHandleCentre(page.locator(`[data-id="${targetNodeId}"] .vue-flow__handle-left`));
  const start = await settledHandleCentre(page.locator(`[data-id="${sourceNodeId}"] .vue-flow__handle-right`));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // VueFlow needs a pointermove over the target in between, or `onConnect`
  // never fires and the drag is discarded in silence. It samples the pointer
  // on rAF, so the approach is two positions a frame apart — one move in the
  // same frame as the release is coalesced away. Same shape as `connectNodes`.
  await page.mouse.move(start.x - 20, start.y + 20, { steps: 3 });
  await page.mouse.move(end.x - 4, end.y - 4, { steps: 10 });
  await page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(resolve)));
  await page.mouse.move(end.x, end.y);
  await page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(resolve)));
  await page.mouse.up();
};

/**
 * Bring the whole graph into view before drawing an edge out of a new node.
 *
 * A node added from the toolbar lands in the execution lane below the seeded
 * row, which on the default viewport is partly off screen — and a handle that is
 * not on screen cannot be pressed. Fitting the view is what a user does when a
 * node arrives out of sight, and unlike nudging it by pixels it does not depend
 * on where the lane happened to put it.
 */
const bringGraphIntoView = async (page: Page) => {
  await page.locator('.vue-flow__controls-fitview').click();
  // The click resolves before the viewport transform does. Nothing waits here,
  // because the wait belongs where the measurement is — `settledHandleCentre`.
};

/** The id VueFlow gave the patch node this spec added. */
async function patchNodeId(page: Page) {
  const id = await draftNode(page).getAttribute('data-id');
  if (!id) throw new Error('The added patch node has no id');
  return id;
}

test.describe('Query group patch node (mocked)', () => {
  test('a new patch node is drawn as one, with both halves already named', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    const node = await addPatchNode(page);

    // Its own kind on the canvas, not the query node's. The data the toolbar
    // pushes is all this node has until an assignment refreshes it, and a patch
    // node drawn as a query node is the exact confusion the type exists to end.
    await expect(node.locator('.node-kind')).toHaveText('Patch Node');

    /*
     * The two ports are minted with the node rather than by an assignment,
     * which is what differs from every other node on the toolbar. A patch node
     * with one port is not a partly-configured patch node — it is a shape the
     * server refuses.
     */
    await expect(editor(page).locator('.port-row .port-name')).toHaveText(['Deletions', 'Additions']);
    await expect(editor(page).locator('.ports-section .port-name')).toHaveText(['deletions', 'additions']);

    /*
     * It names an update and reads a store, so it takes the assignment and
     * backend controls a query node takes.
     *
     * By test id rather than by `#node-backend-select`: #403 made that control
     * a `SearchSelect`, which carries the name as `data-testid` on its input —
     * the id went with the `<select>`. The ruleset spec beside this one was
     * updated with that change and this one, merged the same evening, was not.
     */
    const queryField = page.getByTestId('node-query-select');
    await expect(queryField).toBeVisible();
    // Unassigned reads as an empty chooser rather than as a sentence: the
    // dropdown that replaced the assignment dialog is the field and the state.
    await expect(queryField).toHaveValue('');
    await expect(page.getByTestId('node-backend-select')).toBeVisible();
  });

  /*
   * Deriving the effect of a SELECT is not a narrower version of anything, and
   * the server refuses the graph outright (`NODE_PATCH_QUERY_NOT_UPDATE`). The
   * canvas checks *before* it assigns: assigning first and reporting after
   * would leave the node holding a query it can never run, for the author to
   * undo.
   */
  test('refuses a query that is not an update, and leaves the node as it was', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await addPatchNode(page);

    await assignQuery(page, EXISTING_QUERY_NAME);

    await expect(toasts(page).getByText(/takes an update query/i)).toBeVisible();
    await expect(page.getByTestId('node-query-select')).toHaveValue('');
    await expect(draftNode(page).locator('.node-kind')).toHaveText('Patch Node');
  });

  test('takes an update, and says what it does with it', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    const node = await addPatchNode(page);

    await assignQuery(page, UPDATE_QUERY_NAME);

    await expect(node.locator('.node-kind')).toHaveText(UPDATE_QUERY_NAME);
    await expect(editor(page).locator('.entity-iri .name')).toHaveText(UPDATE_QUERY_NAME);
    // The promise of the node, on the node: it reads the store and writes
    // nothing back.
    await expect(editor(page).getByText(/leaves the store as it found it/i)).toBeVisible();
    // The halves are the node's own, so an assignment does not disturb them.
    await expect(editor(page).locator('.port-row .port-name')).toHaveText(['Deletions', 'Additions']);
  });

  /*
   * The halves are only distinguishable by which port they left through, so an
   * RDF edge out of a patch node has two candidates and binds neither: the
   * author picks. That is the affordance this whole node type turns on.
   */
  test('an edge out of one asks which half it carries', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await addPatchNode(page);
    await assignQuery(page, UPDATE_QUERY_NAME);

    const patchId = await patchNodeId(page);
    await bringGraphIntoView(page);
    await connectNodes(page, patchId, END_NODE_ID);

    /*
     * RDF without being asked. The rule table keys on the source's query type,
     * and this node's query is an update — which that table reads as "produces
     * no output data" and would answer with a control flow edge. What the node
     * emits is the derived patch, not its query's result.
     */
    await expect(page.locator('#edge-flow-select')).toHaveValue('RDF_GRAPH');
    const sourcePicker = page.locator('#source-output-select');
    await sourcePicker.click();
    await expect(page.getByRole('option', { name: 'deletions' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'additions' })).toBeVisible();
    await page.getByRole('option', { name: 'additions' }).click();
    await expect(sourcePicker).toContainText('additions');
  });

  test('the node, its update and both halves survive a save and a reload', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await addPatchNode(page);
    await assignQuery(page, UPDATE_QUERY_NAME);
    const patchId = await patchNodeId(page);
    await bringGraphIntoView(page);
    await connectNodes(page, patchId, END_NODE_ID);

    /*
     * Which half this edge carries is the author's to say — two candidates, so
     * nothing binds itself — and it is the thing the save has to carry.
     */
    await page.locator('#source-output-select').click();
    await page.getByRole('option', { name: 'additions' }).click();

    const createVersion = versionCreateRequest(page);
    await saveQueryGroupNewVersion(page);
    const payload = (await createVersion).postDataJSON();

    /*
     * Sent back as what it is. A node carried over as a QueryNode would be
     * asking the server to save a node that *runs* the update — the destructive
     * change the writer's guard exists to refuse.
     */
    const savedNode = payload.executionNodes.find((node: { nodeType?: string }) => node.nodeType === 'PatchNode');
    expect(savedNode).toBeTruthy();
    expect(savedNode.queryId).toBe(UPDATE_QUERY_VERSION_ID);
    expect(savedNode.backendId).toBe(BACKEND_ID);

    // Both halves, by name, distinct, and each one of the node's own outputs.
    expect(savedNode.deletionsOutput).toBeTruthy();
    expect(savedNode.additionsOutput).toBeTruthy();
    expect(savedNode.deletionsOutput).not.toBe(savedNode.additionsOutput);
    expect(savedNode.outputs).toEqual(
      expect.arrayContaining([savedNode.deletionsOutput, savedNode.additionsOutput]),
    );

    // They go with it as group-owned RDF I/O entities: no query version
    // declares them, so nothing else would carry them.
    const rdfIds = (payload.rdfOutputs ?? []).map((entity: { id: string }) => entity.id);
    expect(rdfIds).toEqual(
      expect.arrayContaining([savedNode.deletionsOutput, savedNode.additionsOutput]),
    );

    // And the edge names which half it took.
    const savedEdge = payload.edges.find((edge: { sourceNodeId?: string }) => edge.sourceNodeId === savedNode.id);
    expect(savedEdge.dataFlowType).toBe('RDF_GRAPH');
    expect(savedEdge.sourceOutputId).toBe(savedNode.additionsOutput);

    await expect(page.locator('.querygroup-work-area [data-testid="version-pill"]')).toContainText('v2');

    /*
     * And back out again, which is the half a payload assertion cannot see. A
     * node that came back as a query node would redraw as one — with a query
     * the canvas would happily run — and its halves would be gone, leaving the
     * saved edge pointing at a port the node no longer declares.
     */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-layout').first()).toBeVisible();
    await openGroupCanvas(page);

    const reloaded = page.locator('.vue-flow__node').filter({ hasText: UPDATE_QUERY_NAME });
    await expect(reloaded).toHaveCount(1);
    await reloaded.click({ position: { x: 3, y: 3 } });
    await expect(editor(page).locator('.node-kind')).toHaveText('PATCH');
    await expect(editor(page).locator('.port-row .port-name')).toHaveText(['Deletions', 'Additions']);
    await expect(editor(page).locator('.ports-section .port-name')).toHaveText(['deletions', 'additions']);
  });

  /*
   * The refusal that would have gone wrong quietly. A patch node has an
   * ephemeral store of its own — that is how it derives over a supplied graph —
   * so the materialization check a query node's RDF input relies on would pass
   * while nothing was ever written into it, and the consumer would query an
   * empty store and answer as if the patch were empty.
   */
  test('refuses to send a half to a query node, and says why', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await addPatchNode(page);
    await assignQuery(page, UPDATE_QUERY_NAME);
    const patchId = await patchNodeId(page);

    const edgesBefore = await page.locator('.vue-flow__edge').count();
    // Drawn rather than reconfigured, because refusing the *connection* is the
    // behaviour: an edge that appeared and then had to be corrected would have
    // already drawn a group the executor rejects.
    await bringGraphIntoView(page);
    await dragConnect(page, patchId, QUERY_NODE_ID);

    await expect(toasts(page).getByText(/no store for a query node to read/i)).toBeVisible();
    await expect(page.locator('.vue-flow__edge')).toHaveCount(edgesBefore);
  });

  test('a patch node with no update stops the save and says why', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await addPatchNode(page);

    /*
     * The serialization refuses a patch node with nothing to derive, and the
     * refusal has to reach the author: the canvas draws an unassigned node the
     * same as an assigned one apart from its title, so a silent no-op would
     * read as a save that worked.
     */
    let posted = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/query-groups\/[^/]+\/v$/.test(new URL(request.url()).pathname)) {
        posted = true;
      }
    });

    await saveQueryGroupNewVersion(page);

    await expect(toasts(page).getByText(/missing the update whose effect it derives/i)).toBeVisible();
    await expect(page.locator('.querygroup-work-area [data-testid="version-pill"]')).toContainText('v1');
    expect(posted).toBe(false);
  });

  /*
   * A ruleset is the consumer a half is meant for: it is handed RDF directly,
   * with no store in between.
   */
  test('a half reaches a ruleset node', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await addPatchNode(page);
    await assignQuery(page, UPDATE_QUERY_NAME);
    const patchId = await patchNodeId(page);

    await page.locator('.add-node-toolbar button[title="Add Ruleset Node"]').click();
    const rulesetNode = page.locator('.vue-flow__node[data-id^="urn:ui-temp:node-"]').last();
    const rulesetId = await rulesetNode.getAttribute('data-id');
    if (!rulesetId) throw new Error('The added ruleset node has no id');
    await editor(page).getByRole('button', { name: 'Assign Ruleset' }).click();
    const dialog = page.locator('[role="dialog"]').last();
    await dialog.locator('.item-row').filter({ hasText: RULE_SET_NAME }).first().click();
    await dialog.getByRole('button', { name: 'Select' }).click();
    await expect(dialog).toBeHidden();

    await bringGraphIntoView(page);
    await moveNodeBy(page, rulesetId, 0, 120);
    await connectNodes(page, patchId, rulesetId);

    await expect(page.locator('#edge-flow-select')).toHaveValue('RDF_GRAPH');
    await expect(page.locator('#target-input-select')).toContainText(`${RULE_SET_NAME} input`);
    // Two candidates on the source side, so nothing binds itself: which half
    // this carries is the author's to say.
    await expect(page.locator('.canvas-editor')).toContainText('Source Output');
  });
});
