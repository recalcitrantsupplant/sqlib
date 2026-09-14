import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapQueryGroupCanvas,
  END_NODE_ID,
  GROUP_NAME,
  LIBRARY_NAME,
  QUERY_NODE_ID,
  START_NODE_ID,
  openCanvasEditorTab,
  selectQueryNode,
  selectSidebarQueryGroup,
} from './query-group-test-helpers';

/*
 * "Add step": the linear-chain shortcut.
 *
 * The canvas has always been able to express a chain and has never made one
 * easy: adding the next query and wiring it up is a toolbar click, a hunt for
 * where the node landed, a drag between two handles, and then the inspector.
 * One button does the first three, so what these specs are about is that the
 * shortcut produces the same graph the long way round does — a node *and* an
 * edge, in one undoable act — and that it says which flow type the edge got
 * rather than leaving it to be discovered.
 *
 * The refusals matter as much as the additions here. A step is the pair, so a
 * source that cannot have one must leave nothing behind, and the button says
 * why it is off rather than being a dead control.
 */

const openGroupCanvas = async (page: Page) => {
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
  await page.locator('.vue-flow__node').first().waitFor();
  await openCanvasEditorTab(page);
};

const addStepButton = (page: Page) => page.locator('.add-node-toolbar .btn-add-step');
const toasts = (page: Page) => page.locator('[data-sonner-toaster]');

/** A node the canvas has just minted, before any save gives it a real IRI. */
const draftNodes = (page: Page) => page.locator('.vue-flow__node[data-id^="urn:ui-temp:node-"]');
const draftEdges = (page: Page) => page.locator('.vue-flow__edge[data-id^="urn:ui-temp:edge-"]');

test.beforeEach(async ({ page }) => {
  await bootstrapQueryGroupCanvas(page);
});

test('adds the next query and the edge feeding it in one click', async ({ page }) => {
  await openGroupCanvas(page);
  await selectQueryNode(page, QUERY_NODE_ID);

  await addStepButton(page).click();

  await expect(draftNodes(page)).toHaveCount(1);
  await expect(draftEdges(page)).toHaveCount(1);
  // The new node is what ends up selected, because choosing its query is the
  // one decision the shortcut cannot make for the author.
  await expect(draftNodes(page)).toHaveClass(/selected/);
  await expect(page.getByTestId('node-query-select')).toBeVisible();
});

test('lands the step to the right of the node it follows, not on top of it', async ({ page }) => {
  await openGroupCanvas(page);
  await selectQueryNode(page, QUERY_NODE_ID);
  const sourceBox = await page.locator(`[data-id="${QUERY_NODE_ID}"]`).boundingBox();

  await addStepButton(page).click();
  const stepBox = await draftNodes(page).boundingBox();

  if (!sourceBox || !stepBox) throw new Error('A node is not on screen');
  expect(stepBox.x).toBeGreaterThan(sourceBox.x);
});

test('stacks a second step from the same node rather than hiding it under the first', async ({ page }) => {
  await openGroupCanvas(page);
  const sourceBox = await page.locator(`[data-id="${QUERY_NODE_ID}"]`).boundingBox();
  await selectQueryNode(page, QUERY_NODE_ID);
  await addStepButton(page).click();
  const firstBox = await draftNodes(page).boundingBox();

  // Back to the original source: a fan-out is two steps from one node, and the
  // second landing exactly on the first is a node the author has to drag off to
  // discover.
  await selectQueryNode(page, QUERY_NODE_ID);
  await addStepButton(page).click();

  await expect(draftNodes(page)).toHaveCount(2);
  const secondBox = await draftNodes(page).nth(1).boundingBox();
  if (!sourceBox || !firstBox || !secondBox) throw new Error('A node is not on screen');
  // Both in the source's next column, one below the other — asserted together,
  // because "somewhere else on the canvas" would also satisfy the second half.
  expect(secondBox.x).toBeGreaterThan(sourceBox.x);
  expect(Math.round(secondBox.x)).toBe(Math.round(firstBox.x));
  expect(Math.abs(secondBox.y - firstBox.y)).toBeGreaterThan(20);
});

test('says what the edge carries, which from a query node is execution order', async ({ page }) => {
  await openGroupCanvas(page);
  await selectQueryNode(page, QUERY_NODE_ID);

  await addStepButton(page).click();

  // A step has no query yet, so it has no query type — the recommender has
  // nothing to key on and the honest edge is a control-flow one. Saying so is
  // what stops the author finding out at the run.
  await expect(toasts(page)).toContainText('runs after');
});

test('carries the group inputs when the step follows the start node', async ({ page }) => {
  await openGroupCanvas(page);
  await page.locator(`[data-id="${START_NODE_ID}"]`).click({ position: { x: 3, y: 3 } });

  await addStepButton(page).click();

  // The one source that can decide without knowing what the step runs: what
  // Start emits is the group's own inputs either way.
  await expect(toasts(page)).toContainText('result rows');
});

test('orders execution after a ruleset instead of leaving the button dead', async ({ page }) => {
  await openGroupCanvas(page);
  await page.locator('.add-node-toolbar button[title^="Add Ruleset Node"]').click();
  const ruleSet = draftNodes(page).first();
  await ruleSet.click({ position: { x: 3, y: 3 } });
  await expect(ruleSet).toHaveClass(/selected/);

  await addStepButton(page).click();

  // A ruleset emits RDF and a query node cannot read one from another node, so
  // following the recommendation here would refuse. The button adds the step
  // and says why the edge is what it is.
  await expect(draftNodes(page)).toHaveCount(2);
  await expect(toasts(page)).toContainText('runs after it rather than taking its output');
});

test('is off with nothing selected, and says what to select', async ({ page }) => {
  await openGroupCanvas(page);

  await expect(addStepButton(page)).toBeDisabled();
  await expect(addStepButton(page)).toHaveAttribute('title', /Select the step this one should follow/);
});

test('is off on the group output, because nothing runs after it', async ({ page }) => {
  await openGroupCanvas(page);
  await page.locator(`[data-id="${END_NODE_ID}"]`).click({ position: { x: 3, y: 3 } });

  await expect(addStepButton(page)).toBeDisabled();
  await expect(addStepButton(page)).toHaveAttribute('title', /Nothing runs after the group output/);
  await expect(draftNodes(page)).toHaveCount(0);
});
