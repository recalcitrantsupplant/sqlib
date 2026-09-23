import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapQueryGroupCanvas,
  chooseFirstQueryInInspector,
  CONTROL_EDGE_ID,
  GROUP_NAME,
  LIBRARY_NAME,
  openCanvasEditorTab,
  QUERY_NODE_ID,
  saveQueryGroupNewVersion,
  selectCanvasEdge,
  selectQueryNode,
  selectSidebarQueryGroup,
  START_NODE_ID,
  START_TUPLE_PORT,
} from './query-group-test-helpers';

/*
 * The dynamic (QUERY_ID) node flow (#47 item 4).
 *
 * A Dynamic Query node is the one execution node whose query is chosen at run
 * time: an edge of flow type QUERY_ID carries the id into a `QueryIdInput` port
 * that the group — not the query version — authors on the node. Nothing until
 * now walked that path in a browser, and it is the part of the canvas with the
 * most machinery per pixel: a toolbar button, a port the inspector mints, a
 * flow type that only one node kind may receive, and a rule that the Start node
 * is allowed to be the source (`legalSourcePortKinds`) even though what it
 * offers is a QueryInputTuple.
 *
 * The specs here author that group from an empty toolbar click rather than
 * seeding it, because the authoring steps are exactly what has never been
 * exercised. The seeded group next door stays the fixture for edges that
 * already exist (`query-group-edge-io.spec.ts`).
 */

const openGroupCanvas = async (page: Page) => {
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
  await page.locator('.vue-flow__node').first().waitFor();
  await openCanvasEditorTab(page);
};

const editor = (page: Page) => page.locator('.canvas-editor');
const flowSelect = (page: Page) => page.locator('#edge-flow-select');

/** The POST that creates the next group version, with the draft as its body. */
const versionCreateRequest = (page: Page) =>
  page.waitForRequest(
    (request) => request.method() === 'POST' && /\/query-groups\/[^/]+\/v$/.test(new URL(request.url()).pathname),
  );

/**
 * Add a Dynamic Query node and hand back the id the canvas minted for it.
 *
 * Adding one selects it (`graph.selectNode`), so the id is readable from the
 * inspector's subtitle rather than guessed from the temp-id counter — which is
 * module state shared with every other node this spec file adds.
 */
async function addDynamicQueryNode(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Dynamic Query', exact: true }).click();
  const subtitle = editor(page).locator('.panel-header__subtitle');
  await expect(subtitle).toHaveText(/^urn:ui-temp:node-/);
  return (await subtitle.innerText()).trim();
}

/**
 * Draw an edge between two nodes, the way an author does.
 *
 * VueFlow starts a connection from a `.vue-flow__handle` and ends it on the
 * other node's handle; nothing short of a real drag gets there, because the
 * connection is built from pointer events on the pane rather than from a click
 * on either end. The handles carry no ids here (`QueryGroupCanvasNode` renders
 * one of each), so they are addressed by the side the left-to-right layout puts
 * them on: source right, target left.
 *
 * The intermediate move matters. A single jump from press to release leaves
 * VueFlow with no pointermove over the target handle, so `onConnect` never
 * fires and the drag is discarded silently.
 */
async function connectNodes(page: Page, sourceNodeId: string, targetNodeId: string) {
  const source = page.locator(`[data-id="${sourceNodeId}"] .vue-flow__handle-right`).first();
  const target = page.locator(`[data-id="${targetNodeId}"] .vue-flow__handle-left`).first();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error(`No handle to drag between ${sourceNodeId} and ${targetNodeId}`);

  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

test.describe('Query group dynamic query nodes (mocked)', () => {
  test('a new dynamic node is drawn as one on the canvas', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);

    const dynamicNodeId = await addDynamicQueryNode(page);

    /*
     * Its own kind, on the node itself. This is the property the ruleset node's
     * spec next door pins, and it is worth pinning here for a reason worth
     * writing down: it holds today by luck rather than by construction.
     *
     * The data the toolbar pushed carried no `kind`, which
     * `QueryGroupCanvasNode` defaults to `query` — the omission that titled a
     * ruleset node "Query Node" until #379, and the reason the note on that PR
     * predicted the same for this one. It never reached the screen. Adding a
     * dynamic node provokes a refresh of every canvas node out of the graph
     * state, which supplies the `kind` the pushed data lacked, and it lands
     * before the node is first painted: sampled every 100ms from the click,
     * this node never once read "Query Node", while a ruleset node added the
     * same way read it indefinitely.
     *
     * So this assertion passes on the code before the fix as well. It is here
     * because "the node says what it is" is the property, and a canvas that
     * holds it only while an unrelated refresh happens to fire is one edit away
     * from not holding it at all.
     */
    const node = page.locator(`.vue-flow__node[data-id="${dynamicNodeId}"]`);
    await expect(node.locator('.node-kind')).toHaveText('Dynamic Query Node');

    // And the seeded ordinary query node beside it still reads as one, so the
    // title is the node's own kind rather than whatever was added last.
    await expect(page.locator(`.vue-flow__node[data-id="${QUERY_NODE_ID}"] .node-kind`)).not.toHaveText(
      'Dynamic Query Node',
    );
  });

  test('only a dynamic node offers a query ID input, and offers exactly one', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);

    // The seeded node is an ordinary QueryNode: it runs the query it was
    // assigned, so there is nothing for a run to choose and no port to add.
    await selectQueryNode(page, QUERY_NODE_ID);
    await expect(editor(page).locator('.panel-header__title')).toHaveText('Query Node');
    await expect(page.getByRole('button', { name: 'Add Query ID Input' })).toBeHidden();

    const dynamicNodeId = await addDynamicQueryNode(page);
    await expect(editor(page).locator('.panel-header__title')).toHaveText('Dynamic Query Node');
    await expect(editor(page).locator('.node-kind')).toHaveText('DYNAMIC');

    const addQueryIdInput = page.getByRole('button', { name: 'Add Query ID Input' });
    await expect(addQueryIdInput).toBeVisible();
    await addQueryIdInput.click();

    /*
     * Adding the port selects it, so the inspector moves off the node and onto
     * the port definition — which is where the author renames it. The default
     * name says which node it belongs to, so a group with two dynamic nodes does
     * not show the same name twice.
     */
    await expect(editor(page).locator('.panel-header__title')).toHaveText('Port Definition');
    await expect(editor(page).locator('.node-kind')).toHaveText('QueryIdInput');
    await expect(page.locator('#io-name-input')).toHaveValue('Dynamic Query query id');

    await selectQueryNode(page, dynamicNodeId);
    const inputPorts = editor(page).locator('.ports-section').filter({ hasText: 'Inputs' }).locator('.port-name');
    await expect(inputPorts).toHaveText(['Dynamic Query query id']);

    /*
     * And only one. A second click hands back the port that exists rather than
     * minting a second: a node that picks its query at run time picks one, and
     * two `QueryIdInput` ports would make `resolveEndpoints` ambiguous on every
     * QUERY_ID edge drawn to it afterwards.
     */
    await addQueryIdInput.click();
    await expect(editor(page).locator('.panel-header__title')).toHaveText('Port Definition');
    await selectQueryNode(page, dynamicNodeId);
    await expect(inputPorts).toHaveText(['Dynamic Query query id']);
  });

  test('a start edge switched to QUERY_ID binds both endpoints by itself', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);

    const dynamicNodeId = await addDynamicQueryNode(page);
    await page.getByRole('button', { name: 'Add Query ID Input' }).click();

    await connectNodes(page, START_NODE_ID, dynamicNodeId);

    /*
     * Drawing the edge selects it, and the recommendation for start → dynamic is
     * VARIABLE_BINDINGS: `edge-flow-type-defaults.json` reaches the QUERY_ID
     * rule only for a SELECT *query* source, so the Start node — which has no
     * query type — lands on the bindings rule above it. The author says QUERY_ID
     * afterwards, which is the step this test is about.
     */
    await expect(flowSelect(page)).toHaveValue('VARIABLE_BINDINGS');
    const newEdgeId = (await editor(page).locator('.panel-header__subtitle').innerText()).trim();
    expect(newEdgeId).toMatch(/^urn:ui-temp:edge-/);

    await flowSelect(page).selectOption('QUERY_ID');

    /*
     * Both ends resolve without the author choosing: the Start node offers one
     * QueryInputTuple and the dynamic node one QueryIdInput, so `autoBind` has
     * no guess to make. This is the half that was missing until
     * `legalSourcePortKinds` learned that a Start node saves a QUERY_ID source
     * as an input tuple — before that the canvas offered no candidate at all and
     * the edge could never resolve.
     */
    await expect(page.locator('#source-output-select')).toContainText('Start Params');
    await expect(page.locator('#target-input-select')).toContainText('Dynamic Query query id');
    await expect(editor(page).locator('[data-testid="edge-diagnostic"]')).toHaveCount(0);

    // A QUERY_ID edge carries no rows, so it has no empty-input policy and no
    // variable grid — the section is an "I/O Mapping", not a "Tuple Mapping".
    await expect(page.locator('#edge-when-empty')).toBeHidden();
    await expect(editor(page).locator('.tuple-mapping-visualization')).toBeHidden();
    await expect(editor(page).locator('.tuple-mapping-section').getByText('I/O Mapping')).toBeVisible();

    // And the canvas says what the edge is now, without the inspector open.
    await expect(page.locator('.edge-label').filter({ hasText: 'query selector' })).toHaveCount(1);
  });

  test('QUERY_ID refuses a target that does not choose its query at run time', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);

    // The seeded control edge already runs start → the ordinary query node.
    await selectCanvasEdge(page, CONTROL_EDGE_ID);
    await flowSelect(page).selectOption('QUERY_ID');

    /*
     * `setEdgeFlowType` refuses a flow type the endpoints cannot carry rather
     * than applying it and reporting the problem, so the edge is still a control
     * edge — and the author has to be told, in the sentence `checkNodeKinds`
     * writes, or the refusal is indistinguishable from having worked.
     */
    await expect(page.getByText('QUERY_ID must target a dynamic node.')).toBeVisible();
    await expect(flowSelect(page)).toHaveValue('CONTROL_FLOW');
    await expect(editor(page).locator('.tuple-mapping-section')).toBeHidden();
  });

  test('a dynamic node and its QUERY_ID edge reach the saved version and come back', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);

    const dynamicNodeId = await addDynamicQueryNode(page);
    await page.getByRole('button', { name: 'Add Query ID Input' }).click();

    /*
     * A dynamic node still needs a query assignment to be saveable — the
     * payload builder refuses a node without one — and the assignment brings
     * the query's default backend with it. What a QUERY_ID edge changes is
     * which query runs, not whether one is named.
     */
    await selectQueryNode(page, dynamicNodeId);
    await chooseFirstQueryInInspector(page);

    await connectNodes(page, START_NODE_ID, dynamicNodeId);
    await flowSelect(page).selectOption('QUERY_ID');
    const queryIdEdgeId = (await editor(page).locator('.panel-header__subtitle').innerText()).trim();

    const createVersion = versionCreateRequest(page);
    await saveQueryGroupNewVersion(page);
    const payload = (await createVersion).postDataJSON();

    const savedNode = payload.executionNodes.find((node: { id: string }) => node.id === dynamicNodeId);
    expect(savedNode.nodeType).toBe('DynamicQueryNode');

    // The port is authored by the group, so it travels in its own array rather
    // than arriving with the query version's inferred ports.
    const savedPort = payload.queryIdInputs.find((input: { name: string }) => input.name === 'Dynamic Query query id');
    expect(savedPort).toBeTruthy();
    expect(savedNode.inputs).toContain(savedPort.id);

    const savedEdge = payload.edges.find((edge: { id: string }) => edge.id === queryIdEdgeId);
    expect(savedEdge.dataFlowType).toBe('QUERY_ID');
    expect(savedEdge.sourceOutputId).toBe(START_TUPLE_PORT);
    expect(savedEdge.targetInputId).toBe(savedPort.id);

    await expect(page.locator('.querygroup-work-area [data-testid="version-pill"]')).toContainText('v2');

    /*
     * And back out again. A port that reaches the payload but not the expanded
     * response leaves the reloaded node with a QUERY_ID edge pointing at
     * nothing, which reads on the canvas as an edge the author drew wrong.
     */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-layout').first()).toBeVisible();
    await openGroupCanvas(page);
    await selectQueryNode(page, dynamicNodeId);
    await expect(editor(page).locator('.panel-header__title')).toHaveText('Dynamic Query Node');
    await expect(
      editor(page).locator('.ports-section').filter({ hasText: 'Inputs' }).locator('.port-name'),
    ).toHaveText(['Dynamic Query query id']);

    await selectCanvasEdge(page, queryIdEdgeId);
    await expect(flowSelect(page)).toHaveValue('QUERY_ID');
    await expect(page.locator('#target-input-select')).toContainText('Dynamic Query query id');
  });
});
