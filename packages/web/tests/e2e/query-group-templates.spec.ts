import { test, expect, type Page } from '@playwright/test';
import {
  createMockState,
  GROUP_ID,
  GROUP_NAME,
  LIBRARY_NAME,
  selectSidebarQueryGroup,
  setupMockApi,
} from './query-group-test-helpers';

/*
 * The guided empty state's templates.
 *
 * `canvasTemplates.test.ts` pins what each template builds, against the
 * invariants and the command contract. What only a browser can say is that the
 * shape reaches the *canvas*: the command produces graph state, and every node
 * in it has to be drawn, positioned and wired by `startFromTemplate`. The gap
 * between "the state holds five edges" and "five edges are on screen" is
 * exactly where `drawAddedNode` lives, and it is the gap issue #379 fell into
 * once already.
 *
 * The empty state is also a layer over the flow surface, so the same
 * pointer-events question `query-group-execution-mocked.spec.ts` pins for "Add
 * your first query" applies to the buttons beside it.
 */

/** A group whose canvas has its boundary and nothing else: a new group. */
const openEmptyCanvas = async (page: Page) => {
  const state = createMockState();
  const expanded = state.queryGroupExpanded[GROUP_ID][1];
  state.queryGroupExpanded[GROUP_ID][1] = { ...expanded, executionNodes: [], edges: [] };
  await setupMockApi(page, state);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-layout').first()).toBeVisible();
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
};

const emptyState = (page: Page) => page.locator('.canvas-surface__empty');
const draftNodes = (page: Page) => page.locator('.vue-flow__node[data-id^="urn:ui-temp:node-"]');
const draftEdges = (page: Page) => page.locator('.vue-flow__edge[data-id^="urn:ui-temp:edge-"]');

test('offers every template beside the first-query button', async ({ page }) => {
  await openEmptyCanvas(page);

  const empty = emptyState(page);
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('button', { name: 'Add your first query' })).toBeVisible();
  await expect(empty.getByRole('button', { name: 'Linear chain' })).toBeVisible();
  await expect(empty.getByRole('button', { name: 'Fan-in merge' })).toBeVisible();
  await expect(empty.getByRole('button', { name: 'Construct, then rules' })).toBeVisible();
});

test('a linear chain arrives drawn and wired, not as two loose boxes', async ({ page }) => {
  await openEmptyCanvas(page);

  await emptyState(page).getByRole('button', { name: 'Linear chain' }).click();

  // Two steps, three edges — Start to the first, first to second, second to End.
  await expect(draftNodes(page)).toHaveCount(2);
  await expect(draftEdges(page)).toHaveCount(3);
  await expect(emptyState(page)).toBeHidden();

  /*
   * The label reaches the app at all: the handler leaves the first step
   * selected with the Editor tab open, which is where the author goes next
   * anyway.
   *
   * This used to carry a note that the card could not show the label — "a live
   * gap rather than this change's". #482 closed that gap, so the card now
   * reads "First query" too; the inspector is still the right place to assert
   * what the *field* holds, which is what this line is about.
   */
  await expect(page.locator('#node-label-input')).toHaveValue('First query');
  await expect(draftNodes(page).filter({ hasText: 'First query' })).toHaveCount(1);
});

test('a fan-in lands its two sources on different rows', async ({ page }) => {
  await openEmptyCanvas(page);

  await emptyState(page).getByRole('button', { name: 'Fan-in merge' }).click();

  await expect(draftNodes(page)).toHaveCount(3);
  await expect(draftEdges(page)).toHaveCount(5);

  // The shape is the point of this template, and a shape whose two sources are
  // stacked on top of each other is one the author has to drag apart before
  // they can read it. Positions come from the template for this reason.
  const boxes = await draftNodes(page).evaluateAll(nodes =>
    nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y) };
    }),
  );
  const rows = new Set(boxes.map(box => box.y));
  expect(rows.size).toBeGreaterThan(1);
});

test('the construct template brings a rule set, which is what can read RDF', async ({ page }) => {
  await openEmptyCanvas(page);

  await emptyState(page).getByRole('button', { name: 'Construct, then rules' }).click();

  await expect(draftNodes(page)).toHaveCount(2);
  await expect(draftEdges(page)).toHaveCount(3);

  /*
   * The node *kind* is the claim worth pinning here: the second step is a rule
   * set rather than the query node the plan's "construct-then-query" would have
   * put there, because only a rule set or the End node can read an upstream RDF
   * graph.
   *
   * Asserted on `data-node-kind` rather than on the card's text. It read the
   * text until #482, when the card title started preferring the author's label
   * — and a template *gives* every step a label, so the two cards stopped
   * reading "Ruleset Node" and "Query Node" and started reading the names below.
   * That was the title becoming right rather than the card losing something,
   * but it left this assertion pinning "nobody has named these nodes", which is
   * not what it was ever for.
   */
  await expect(draftNodes(page).filter({ has: page.locator('[data-node-kind="ruleset"]') })).toHaveCount(1);
  await expect(draftNodes(page).filter({ has: page.locator('[data-node-kind="query"]') })).toHaveCount(1);

  // And the labels themselves, which are now on the cards: the half of #482
  // this template feature is the beneficiary of, so it is pinned where it shows.
  await expect(draftNodes(page).filter({ hasText: 'Construct graph' })).toHaveCount(1);
  await expect(draftNodes(page).filter({ hasText: 'Apply rules' })).toHaveCount(1);
});

test('the templates leave once a shape has been taken', async ({ page }) => {
  await openEmptyCanvas(page);

  await emptyState(page).getByRole('button', { name: 'Linear chain' }).click();
  await expect(draftNodes(page)).toHaveCount(2);

  // A template starts a group; there is no second one to start. The command
  // refuses a canvas that already has steps, and the empty state going away is
  // what keeps the author from meeting that refusal.
  await expect(emptyState(page)).toBeHidden();
});
