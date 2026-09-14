import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapQueryGroupCanvas,
  END_NODE_ID,
  GROUP_NAME,
  LIBRARY_NAME,
  NODE_OUTPUT_PORT,
  QUERY_NODE_ID,
  RULE_SET_NAME,
  RULE_SET_VERSION_1_ID,
  connectNodes,
  moveNodeBy,
  openCanvasEditorTab,
  saveQueryGroupNewVersion,
  selectSidebarQueryGroup,
} from './query-group-test-helpers';

/*
 * The ruleset node flow (#47 item 4).
 *
 * A RuleSetNode is the third kind of execution node and the only one that runs
 * something other than a query: it takes an RDF graph in, applies a ruleset,
 * and hands the inferences back out. None of that had ever been driven through
 * the UI — the seeded group has a query node and nothing else, so every path
 * here (the toolbar button, the selector dialog, the RDF ports the assignment
 * mints, and the shape the save writes) ran for the first time in these specs.
 *
 * The node is authored rather than seeded, deliberately: the assignment is what
 * gives the node its ports, so a fixture that arrived with them would test the
 * loader and skip the flow.
 */

const openGroupCanvas = async (page: Page) => {
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
  await page.locator('.vue-flow__node').first().waitFor();
  await openCanvasEditorTab(page);
};

const editor = (page: Page) => page.locator('.canvas-editor');
/** A node the canvas has just minted, before any save gives it a real IRI. */
const draftNode = (page: Page) => page.locator('.vue-flow__node[data-id^="urn:ui-temp:node-"]');

/** The POST that creates the next group version, with the draft as its body. */
const versionCreateRequest = (page: Page) =>
  page.waitForRequest(
    (request) => request.method() === 'POST' && /\/query-groups\/[^/]+\/v$/.test(new URL(request.url()).pathname),
  );

/**
 * Add a ruleset node and select it.
 *
 * `addRulesetNode` selects the new node itself, but a click is what a user
 * does, and selecting through the node's top-left corner is the only way that
 * survives the collapsed node being mostly its own toggle button (see
 * `selectQueryNode`).
 */
const addRulesetNode = async (page: Page) => {
  await page.locator('.add-node-toolbar button[title="Add Ruleset Node"]').click();
  const node = draftNode(page);
  await expect(node).toHaveCount(1);
  await node.click({ position: { x: 3, y: 3 } });
  await expect(node).toHaveClass(/selected/);
  return node;
};

/**
 * Assign a ruleset through the dialog the inspector opens.
 *
 * The version picker only exists for a ruleset with more than one version;
 * `versionLabel` picks one, and omitting it takes the current version the
 * selector pre-selects.
 */
const assignRuleSet = async (page: Page, ruleSetName: string, versionLabel?: string) => {
  await editor(page).getByRole('button', { name: 'Assign Ruleset' }).click();
  const dialog = page.locator('[role="dialog"]').last();
  await expect(dialog.getByText('Select Ruleset')).toBeVisible();
  const row = dialog.locator('.item-row').filter({ hasText: ruleSetName }).first();
  await row.click();
  if (versionLabel) {
    await row.locator('.version-trigger').first().click();
    await page.getByRole('option', { name: new RegExp(`\\b${versionLabel}\\b`) }).click();
  }
  await dialog.getByRole('button', { name: 'Select' }).click();
  await expect(dialog).toBeHidden();
};

test.describe('Query group ruleset node (mocked)', () => {
  test('a new ruleset node is drawn as one, and says what it is missing', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    const node = await addRulesetNode(page);

    // Its own kind on the canvas, not the query node's. The data the toolbar
    // pushes is all this node has until an assignment refreshes it.
    await expect(node.locator('.node-kind')).toHaveText('Ruleset Node');

    // A ruleset node runs no query, so the inspector offers neither a query
    // assignment nor a backend — the two things every other execution node has.
    await expect(editor(page).getByText('No ruleset assigned')).toBeVisible();
    await expect(editor(page).getByRole('button', { name: 'Assign Ruleset' })).toBeVisible();
    await expect(page.getByTestId('node-backend-select')).toBeHidden();
    await expect(page.getByTestId('node-query-select')).toBeHidden();

    /*
     * And the empty port list names the thing that would fill it. The generic
     * answer here is "this query version declares no inputs or outputs", which
     * is about a query version this node does not have.
     */
    const ioState = editor(page).locator('[data-io-state]');
    await expect(ioState).toHaveAttribute('data-io-state', 'empty');
    await expect(ioState).toHaveText('Assign a ruleset to give this node its RDF input and output.');
  });

  test('assigning a ruleset names the node and gives it one RDF port each way', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    const node = await addRulesetNode(page);

    await assignRuleSet(page, RULE_SET_NAME, '2');

    // The ruleset is what the node is now called, on the canvas and in the
    // inspector's header row.
    await expect(node.locator('.node-kind')).toHaveText(RULE_SET_NAME);
    await expect(editor(page).getByText(RULE_SET_NAME).first()).toBeVisible();

    /*
     * The ports the assignment mints. They belong to the group rather than to
     * any query version — a ruleset declares no interface of its own — which is
     * why they are named after the ruleset and not after anything the server
     * resolved.
     */
    await expect(editor(page).locator('.ports-section .port-name')).toHaveText([
      `${RULE_SET_NAME} input`,
      `${RULE_SET_NAME} output`,
    ]);
    await expect(editor(page).locator('[data-io-state]')).toHaveCount(0);
  });

  test('a dismissed selector assigns nothing, and the next open still does', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    const node = await addRulesetNode(page);

    await editor(page).getByRole('button', { name: 'Assign Ruleset' }).click();
    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog.getByText('Select Ruleset')).toBeVisible();

    /*
     * Escape is the fourth way out of this dialog and the one that does not
     * reach `cancel`: the selector emits `update:open` for a dismissal and
     * `cancel` only for its own button, so this is the exit that used to lower
     * the dialog while leaving the work area still holding the node.
     */
    await dialog.locator('.item-row').filter({ hasText: RULE_SET_NAME }).first().click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Picking a ruleset and then dismissing assigns nothing: the node is as it
    // was, and says so.
    await expect(node.locator('.node-kind')).toHaveText('Ruleset Node');
    await expect(editor(page).getByText('No ruleset assigned')).toBeVisible();
    await expect(editor(page).locator('[data-io-state]')).toHaveAttribute('data-io-state', 'empty');

    // And the dismissal left nothing behind that the next assignment trips on.
    await assignRuleSet(page, RULE_SET_NAME);
    await expect(node.locator('.node-kind')).toHaveText(RULE_SET_NAME);
    await expect(editor(page).locator('.ports-section .port-name')).toHaveText([
      `${RULE_SET_NAME} input`,
      `${RULE_SET_NAME} output`,
    ]);
  });

  test('a ruleset node reads the RDF an upstream node produces', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await addRulesetNode(page);
    await assignRuleSet(page, RULE_SET_NAME);

    // The End node sits over the query node's source handle on the seeded
    // layout; nothing can be dragged out of a handle a node is covering.
    await moveNodeBy(page, END_NODE_ID, 0, 250);
    await connectNodes(page, QUERY_NODE_ID, await rulesetNodeId(page));

    /*
     * RDF_GRAPH without being asked: a ruleset speaks RDF in both directions,
     * so `recommendFlowType` short-circuits the rule table for it. And with one
     * TriplesQuadsIO candidate on each side, the endpoints bind themselves —
     * the query node's constructed graph into the ruleset's input.
     */
    await expect(page.locator('#edge-flow-select')).toHaveValue('RDF_GRAPH');
    await expect(page.locator('#source-output-select')).toContainText('City RDF');
    await expect(page.locator('#target-input-select')).toContainText(`${RULE_SET_NAME} input`);
  });

  test('the node, its ruleset and its ports survive a save and a reload', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await addRulesetNode(page);
    await assignRuleSet(page, RULE_SET_NAME, '1');
    // The End node sits over the query node's source handle on the seeded
    // layout; nothing can be dragged out of a handle a node is covering.
    await moveNodeBy(page, END_NODE_ID, 0, 250);
    await connectNodes(page, QUERY_NODE_ID, await rulesetNodeId(page));

    const createVersion = versionCreateRequest(page);
    await saveQueryGroupNewVersion(page);
    const payload = (await createVersion).postDataJSON();

    /*
     * A RuleSetNode is its own shape on the wire: no query, no backend, and the
     * ruleset *version* it runs. The version is the point — a group pinned to
     * "whatever the ruleset says today" would not be a snapshot.
     */
    const savedNode = payload.executionNodes.find((node: { nodeType?: string }) => node.nodeType === 'RuleSetNode');
    expect(savedNode).toBeTruthy();
    expect(savedNode.ruleSetVersion).toBe(RULE_SET_VERSION_1_ID);
    expect(savedNode.queryId).toBeUndefined();
    expect(savedNode.backendId).toBeUndefined();
    expect(savedNode.inputs).toHaveLength(1);
    expect(savedNode.outputs).toHaveLength(1);

    // The ports go with it, as group-owned RDF I/O entities rather than
    // anything a query version declares.
    const rdfIds = (payload.rdfOutputs ?? []).map((entity: { id: string }) => entity.id);
    expect(rdfIds).toEqual(expect.arrayContaining([savedNode.inputs[0], savedNode.outputs[0]]));

    const savedEdge = payload.edges.find(
      (edge: { targetNodeId?: string }) => edge.targetNodeId === savedNode.id,
    );
    expect(savedEdge.dataFlowType).toBe('RDF_GRAPH');
    expect(savedEdge.sourceOutputId).toBe(NODE_OUTPUT_PORT);
    expect(savedEdge.targetInputId).toBe(savedNode.inputs[0]);

    await expect(page.locator('.querygroup-work-area [data-testid="version-pill"]')).toContainText('v2');

    /*
     * And back out again, which is the half a payload assertion cannot see: the
     * node has to come back as a *ruleset* node — one that came back as a query
     * node with no query would redraw as broken — still naming the version it
     * was pinned to, and still carrying its ports.
     */
    await page.reload();
    await page.waitForLoadState('networkidle');
    await openGroupCanvas(page);

    const reloaded = page.locator('.vue-flow__node').filter({ hasText: RULE_SET_NAME });
    await expect(reloaded).toHaveCount(1);
    await reloaded.click({ position: { x: 3, y: 3 } });
    /*
     * By name, which is the part a reload can lose: the canvas labels a node
     * from the version response's `iriMap`, and that map carried query versions
     * only — so an assigned ruleset came back as "Unknown" while the query node
     * beside it kept its name. The API now maps rule set versions too.
     */
    await expect(editor(page).locator('.entity-iri .name')).toHaveText(RULE_SET_NAME);
    await expect(editor(page).locator('.ports-section .port-name')).toHaveText([
      `${RULE_SET_NAME} input`,
      `${RULE_SET_NAME} output`,
    ]);
  });

  test('a ruleset node with no ruleset stops the save and says why', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await addRulesetNode(page);

    /*
     * The serialization refuses a RuleSetNode with nothing to run, and the
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

    await expect(
      page.locator('[data-sonner-toaster]').getByText(/missing a ruleSetVersion/i),
    ).toBeVisible();
    await expect(page.locator('.querygroup-work-area [data-testid="version-pill"]')).toContainText('v1');
    expect(posted).toBe(false);
  });
});

/** The id VueFlow gave the ruleset node this spec added. */
async function rulesetNodeId(page: Page) {
  const id = await draftNode(page).getAttribute('data-id');
  if (!id) throw new Error('The added ruleset node has no id');
  return id;
}
