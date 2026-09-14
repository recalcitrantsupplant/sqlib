import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapQueryGroupCanvas,
  connectNodes,
  END_NODE_ID,
  GROUP_NAME,
  LIBRARY_NAME,
  moveNodeBy,
  openCanvasEditorTab,
  QUERY_NODE_ID,
  RULE_SET_NAME,
  saveQueryGroupNewVersion,
  selectSidebarQueryGroup,
  type NodeDetailFixture,
} from './query-group-test-helpers';

/*
 * Per-node result inspection (#47 item 4, the last flow on its list).
 *
 * A group run is several queries, and "it worked" is the least interesting
 * thing about it: which node was slow, which one returned nothing, which one
 * broke the chain. `/execute?nodeDetail=results` answers all three, and
 * `useCanvasExecutionStatus` paints the answer onto the graph — which is the
 * only place it is ever shown, since the Results tab holds the *group's* result
 * and says nothing about the nodes that made it.
 *
 * None of that had ever run in a spec, for a reason worth recording: the mock
 * answered `/execute` with a bare SPARQL JSON body, and the client only reads
 * node detail out of the `{ result, nodes, resultContentType }` envelope. The
 * server has no choice about that envelope — with `nodeDetail` set it always
 * replies `application/json` wrapping the result, whatever the result's type —
 * and the group screen sets `nodeDetail` on every run. So the mock was
 * answering a request the client makes with a response no server can give, and
 * every decoration below was unreachable while the fixture stayed perfectly
 * valid. `wrapExecutionResponse` now decides the shape from the request.
 */

const openGroupCanvas = async (page: Page) => {
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
  await page.locator('.vue-flow__node').first().waitFor();
};

/** Run the group, and wait for the reply rather than for a repaint. */
const runGroup = async (page: Page) => {
  const executed = page.waitForResponse(
    (response) => response.url().includes('/execute') && response.request().method() === 'POST',
  );
  await page.getByTestId('run-bar-run').click();
  await executed;
};

const canvasNode = (page: Page, nodeId: string) => page.locator(`[data-id="${nodeId}"] .query-group-node`);

const SELECT_RESULT = {
  head: { vars: ['city'] },
  results: {
    bindings: [
      { city: { type: 'uri', value: 'https://example.org/city/1' } },
      { city: { type: 'uri', value: 'https://example.org/city/2' } },
    ],
  },
};

const CONSTRUCT_RESULT = [
  '<https://example.org/city/1> <http://schema.org/name> "Paris" .',
  '<https://example.org/city/2> <http://schema.org/name> "Berlin" .',
  '<https://example.org/city/3> <http://schema.org/name> "Madrid" .',
].join('\n');

test.describe('Query group per-node results (mocked)', () => {
  test('a node that ran says so, with its time and how much it returned', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page, {
      executionResponse: {
        contentType: 'application/sparql-results+json',
        body: SELECT_RESULT,
        nodes: [{ nodeId: QUERY_NODE_ID, status: 'ok', durationMs: 137, rowCount: 2, result: SELECT_RESULT }],
      },
    });
    await openGroupCanvas(page);
    await runGroup(page);

    const node = canvasNode(page, QUERY_NODE_ID);
    await expect(node).toHaveClass(/ran-ok/);
    await expect(node.locator('.node-execution-status')).toHaveText('Done');
    // Both chips, in the order the node draws them: how long, then how much.
    await expect(node.locator('.node-execution-chip')).toHaveText(['137ms', '2 rows']);

    // The group's own result still arrives, unwrapped from the same envelope.
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'https://example.org/city/2' })).toBeVisible();
  });

  test('a node that produced a graph counts triples, and the graph renders as one', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page, {
      executionResponse: {
        contentType: 'application/n-triples',
        body: CONSTRUCT_RESULT,
        nodes: [{ nodeId: QUERY_NODE_ID, status: 'ok', durationMs: 1400, tripleCount: 3, result: CONSTRUCT_RESULT }],
      },
    });
    await openGroupCanvas(page);
    await runGroup(page);

    const node = canvasNode(page, QUERY_NODE_ID);
    // Triples, not rows — the label follows which count the node reported. And a
    // second past which the chip switches units.
    await expect(node.locator('.node-execution-chip')).toHaveText(['1.40s', '3 triples']);

    /*
     * The result's own media type, which the envelope has to carry: the reply is
     * `application/json` because the envelope is, so a CONSTRUCT's N-Triples
     * arrives as a bare string with nothing saying what it is. The client used
     * to fall back to `selectedResultFormat` — a ref this screen has no control
     * for, so always SPARQL JSON — and the viewer, which picks the triples table
     * off the content type, rendered RDF as raw text instead.
     */
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'schema:name' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Madrid' }).first()).toBeVisible();
  });

  test('the slowest node of a run is the one marked', async ({ page }) => {
    /*
     * Two execution nodes, because "where did the time go" is a comparison and a
     * one-node group cannot pose the question. The second is authored rather
     * than seeded for the reason the ruleset specs give: the seeded group has a
     * query node and nothing else.
     */
    let nodes: NodeDetailFixture[] = [];
    await bootstrapQueryGroupCanvas(page, {
      executionResponse: () => ({
        contentType: 'application/n-triples',
        body: CONSTRUCT_RESULT,
        nodes,
      }),
    });
    await openGroupCanvas(page);
    await openCanvasEditorTab(page);

    await page.locator('.add-node-toolbar button[title="Add Ruleset Node"]').click();
    const draft = page.locator('.vue-flow__node[data-id^="urn:ui-temp:node-"]');
    await expect(draft).toHaveCount(1);
    await draft.click({ position: { x: 3, y: 3 } });
    await page.locator('.canvas-editor').getByRole('button', { name: 'Assign Ruleset' }).click();
    const dialog = page.locator('[role="dialog"]').last();
    await dialog.locator('.item-row').filter({ hasText: RULE_SET_NAME }).first().click();
    await dialog.getByRole('button', { name: 'Select' }).click();
    await expect(dialog).toBeHidden();

    // The End node covers the query node's source handle on the seeded layout.
    await moveNodeBy(page, END_NODE_ID, 0, 250);
    const draftId = await draft.getAttribute('data-id');
    await connectNodes(page, QUERY_NODE_ID, draftId!);

    // A run needs a saved version: the server re-runs what it was given, not
    // what is on screen.
    await saveQueryGroupNewVersion(page);
    await expect(page.locator('.querygroup-work-area [data-testid="version-pill"]')).toContainText('v2');

    // The saved node has the id the server minted, so the fixture can only be
    // written once the canvas is carrying it.
    const rulesetNode = page.locator('.vue-flow__node').filter({ hasText: RULE_SET_NAME });
    const rulesetId = await rulesetNode.getAttribute('data-id');
    nodes = [
      { nodeId: QUERY_NODE_ID, status: 'ok', durationMs: 40, rowCount: 2 },
      { nodeId: rulesetId!, status: 'ok', durationMs: 260, tripleCount: 3 },
    ];

    await runGroup(page);

    // One node is marked, and it is the slow one — the mark is on the duration
    // chip, since it is the duration it is a remark about.
    const marked = page.locator('.query-group-node .node-execution-chip.slowest');
    await expect(marked).toHaveCount(1);
    await expect(marked).toHaveText('260ms');
    await expect(canvasNode(page, rulesetId!).locator('.node-execution-chip.slowest')).toBeVisible();
    await expect(canvasNode(page, QUERY_NODE_ID).locator('.node-execution-chip').first()).not.toHaveClass(/slowest/);
  });

  test('a node that failed carries the reason it gives', async ({ page }) => {
    const message = 'Backend refused the query: HTTP 503';
    await bootstrapQueryGroupCanvas(page, {
      executionResponse: {
        status: 500,
        contentType: 'application/json',
        body: {
          error: 'Node execution failed',
          message,
          failedNodeId: QUERY_NODE_ID,
          nodes: [{ nodeId: QUERY_NODE_ID, status: 'failed', error: message, durationMs: 88 }],
        },
      },
    });
    await openGroupCanvas(page);
    await runGroup(page);

    const node = canvasNode(page, QUERY_NODE_ID);
    await expect(node).toHaveClass(/ran-failed/);
    await expect(node.locator('.node-execution-status')).toHaveText('Failed');
    // The reason on the node itself, in full in its title — the line is clipped
    // to the node's width, and a truncated error is not one you can act on.
    await expect(node.locator('.node-execution-error')).toHaveText(message);
    await expect(node.locator('.node-execution-error')).toHaveAttribute('title', message);
    // It still reports how long it took to fail, which is how a timeout is told
    // apart from a rejection.
    await expect(node.locator('.node-execution-chip')).toHaveText(['88ms']);
  });

  test('a node named by a failure that never reported it is still marked failed', async ({ page }) => {
    /*
     * The engine stops at the first failure, and a node can break before it has
     * reported anything of its own — so the error body names `failedNodeId` with
     * no entry for it in `nodes`. Without the fallback in
     * `useCanvasExecutionStatus` the canvas would draw that run as if nothing
     * had happened, which is the one case where saying nothing is worst.
     */
    await bootstrapQueryGroupCanvas(page, {
      executionResponse: {
        status: 500,
        contentType: 'application/json',
        body: {
          error: 'Node execution failed',
          failedNodeId: QUERY_NODE_ID,
          nodes: [],
        },
      },
    });
    await openGroupCanvas(page);
    await runGroup(page);

    const node = canvasNode(page, QUERY_NODE_ID);
    await expect(node).toHaveClass(/ran-failed/);
    await expect(node.locator('.node-execution-status')).toHaveText('Failed');
    // Nothing was reported, so there is nothing to report: no time, no count,
    // and no error line invented for it.
    await expect(node.locator('.node-execution-chip')).toHaveCount(0);
    await expect(node.locator('.node-execution-error')).toHaveCount(0);
  });
});
