import { test, expect, type Page } from '@playwright/test';
import {
  ARGUMENT_SET_NAME,
  createMockState,
  END_NODE_ID,
  EXISTING_QUERY_ID,
  GROUP_ID,
  GROUP_NAME,
  LIBRARY_NAME,
  moveNodeBy,
  NODE_INPUT_PORT,
  NODE_OUTPUT_PORT,
  QUERY_NODE_ID,
  selectSidebarQueryGroup,
  setupMockApi,
  type MockState,
  type SetupMockApiOptions,
} from './query-group-test-helpers';
import { FIXED_NOW, setTheme, stabilise } from './visual-helpers';

/**
 * Visual regression baselines for the query group canvas states (#47 item 5).
 *
 * `visual-regression.spec.ts` has one canvas shot — the seeded group, at rest.
 * That is the screen the canvas spends the least time in. The states this file
 * baselines are the ones the canvas exists to draw: a group with nothing in it
 * yet, a run that worked, a run that broke, a graph the server refuses to run,
 * and the arguments a run is made with.
 *
 * They are here rather than in `visual-regression.spec.ts` because they need
 * the stateful canvas mock (`query-group-test-helpers.ts`), which answers
 * `/execute` and `/validate` from a per-test fixture, and that spec's fixtures
 * answer neither. A file of its own also means its baselines live in their own
 * `-snapshots` directory, so adding these shots cannot disturb the 42 already
 * committed.
 *
 * RUN AGAINST THE PRODUCTION PREVIEW, NOT THE DEV SERVER — same reason and same
 * commands as `visual-regression.spec.ts`:
 *
 *     pnpm build && pnpm preview &
 *     npx playwright test visual-canvas-states
 *
 * BASELINES ARE NOT COMMITTED FOR THIS FILE YET. They are rasterised with the
 * authoring machine's font stack (which is why the lane is excluded from CI at
 * all — see `scripts/ci/e2e.sh`), so a baseline written in a cloud container
 * would fail on the machine that owns every other shot in the suite. Generate
 * them once, review them, and commit:
 *
 *     pnpm --filter @sparql-query-lib/web exec playwright test \
 *       visual-canvas-states --update-snapshots
 *
 * `test/visualBaselines.test.ts` lists them as pending until then,
 * and fails the day one is left unbaselined by accident rather than on purpose.
 */

/** Every shot is the same screen at 1600×950 with the canvas already drawn. */
const openGroupCanvas = async (page: Page) => {
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
  await page.locator('.vue-flow__node').first().waitFor();
};

/**
 * Slide the End node clear of the query node.
 *
 * The seeded graph stores no positions, so the canvas lays it out itself and
 * puts End over the query node's right-hand end — which is exactly where the
 * validation badge and the node's handles are drawn. Every other spec works
 * around it the same way (`query-group-node-results.spec.ts`); a shot has to,
 * because the thing it is a picture of is underneath.
 */
const clearEndNode = (page: Page) => moveNodeBy(page, END_NODE_ID, 0, 250);

/**
 * Park the pointer somewhere that reacts to nothing.
 *
 * Getting to the canvas leaves the cursor on the last sidebar row it clicked,
 * which renders that row's hover affordances — and dragging the End node leaves
 * it on the node. Neither is part of the state being photographed, and both
 * would be baselined as if they were. An empty patch of canvas has no hover of
 * its own, so it is the one place the pointer can rest.
 */
const parkPointer = (page: Page) => page.mouse.move(900, 380);

/** Run the group, and wait for the reply rather than for a repaint. */
const runGroup = async (page: Page) => {
  const executed = page.waitForResponse(
    (response) => response.url().includes('/execute') && response.request().method() === 'POST',
  );
  await page.getByTestId('run-bar-run').click();
  await executed;
};

/**
 * The seeded group, with the two things the live validator objects to fixed.
 *
 * Worth stating plainly, because it is a finding rather than a preference: the
 * shared canvas fixture draws a group that `useQueryGroupLiveValidation` calls
 * broken, in every spec that renders it. Two causes, both in the fixture rather
 * than in the app:
 *
 * 1. The expansion describes no `queryVersions`, so the node's query version
 *    cannot be resolved and the node carries a blocking
 *    `NODE_QUERY_VERSION_UNREADABLE` — "the saved group did not describe this
 *    query version".
 * 2. The control-flow edge names a source port. Control flow orders execution
 *    and carries no data, so a port on it is `control-flow-has-endpoint`.
 *
 * The functional specs never noticed because they assert on other things. A
 * baseline would not have that excuse: it is a picture, and a picture of a
 * permanently red canvas is a poor reference for what a healthy one looks like.
 * The patch is applied here rather than in `fixtures/query-group-mock-state.ts`
 * because ten specs share that file and the ports it hands out are what several
 * of them click; moving it there is its own change, with its own e2e run.
 */
const healthyGroupState = (): MockState => {
  const state = createMockState();
  const expanded = state.queryGroupExpanded[GROUP_ID][1];
  const queryVersion = state.queryVersions[EXISTING_QUERY_ID][0];

  state.queryGroupExpanded[GROUP_ID][1] = {
    ...expanded,
    queryVersions: [
      {
        ...queryVersion,
        // The ports the node already declares, so nothing about the drawn graph
        // changes — only whether the node can say where they came from.
        inferredInputs: [NODE_INPUT_PORT],
        inferredOutputs: [NODE_OUTPUT_PORT],
      },
    ],
    edges: expanded.edges.map((edge) =>
      edge.dataFlowType === 'CONTROL_FLOW' ? { ...edge, sourceOutputId: null } : edge,
    ),
  };
  return state;
};

/**
 * The same group with its one execution node and its edges removed.
 *
 * `canvasIsEmpty` is "every node is the start or the end node", so this is what
 * a group looks like between being created and having its first step added —
 * the state a new group is always in, and the only one of these five that no
 * fixture could reach by running something.
 */
const emptyGroupState = (): MockState => {
  const state = healthyGroupState();
  const expanded = state.queryGroupExpanded[GROUP_ID][1];
  state.queryGroupExpanded[GROUP_ID][1] = { ...expanded, executionNodes: [], edges: [] };
  return state;
};

const SELECT_RESULT = {
  head: { vars: ['city'] },
  results: {
    bindings: [
      { city: { type: 'uri', value: 'https://example.org/city/1' } },
      { city: { type: 'uri', value: 'https://example.org/city/2' } },
    ],
  },
};

const NODE_FAILURE = 'Backend refused the query: HTTP 503';

for (const theme of ['light', 'dark'] as const) {
  /*
   * Tagged @visual for the same reason as every other shot: the baselines carry
   * the authoring machine's font rasterisation, and a GitHub runner's differs.
   */
  test.describe(`visual — canvas — ${theme}`, { tag: '@visual' }, () => {
    /*
     * The mock is per test rather than in a `beforeEach`, because what each of
     * these shots is a picture of *is* its fixture. What the hook can carry is
     * everything that must be true before the first navigation.
     */
    const boot = async (page: Page, options: SetupMockApiOptions = {}, state: MockState = healthyGroupState()) => {
      await setupMockApi(page, state, options);
      await page.goto('/');
      await page.waitForLoadState('networkidle');
    };

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(FIXED_NOW);
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1600, height: 950 });
    });

    test(`canvas — no steps yet`, async ({ page }) => {
      await boot(page, {}, emptyGroupState());
      await openGroupCanvas(page);
      await expect(page.locator('.canvas-surface__empty')).toBeVisible();
      await parkPointer(page);
      await stabilise(page);
      await expect(page).toHaveScreenshot(`canvas-empty-${theme}.png`, { fullPage: false });
    });

    test(`canvas — a node that ran`, async ({ page }) => {
      await boot(page, {
        executionResponse: {
          contentType: 'application/sparql-results+json',
          body: SELECT_RESULT,
          nodes: [{ nodeId: QUERY_NODE_ID, status: 'ok', durationMs: 137, rowCount: 2, result: SELECT_RESULT }],
        },
      });
      await openGroupCanvas(page);
      await clearEndNode(page);
      await runGroup(page);

      /*
       * Wait for the decoration, not for the response: the ring, the status
       * line and both chips are painted by `useCanvasExecutionStatus` after the
       * reply is parsed, and a shot taken on the response alone catches the
       * node mid-repaint often enough to matter.
       */
      const node = page.locator(`[data-id="${QUERY_NODE_ID}"] .query-group-node`);
      await expect(node).toHaveClass(/ran-ok/);
      await expect(node.locator('.node-execution-chip')).toHaveText(['137ms', '2 rows']);
      await parkPointer(page);
      await stabilise(page);
      await expect(page).toHaveScreenshot(`canvas-run-ok-${theme}.png`, { fullPage: false });
    });

    test(`canvas — a node that failed`, async ({ page }) => {
      await boot(page, {
        executionResponse: {
          status: 500,
          contentType: 'application/json',
          body: {
            error: 'Node execution failed',
            message: NODE_FAILURE,
            failedNodeId: QUERY_NODE_ID,
            nodes: [{ nodeId: QUERY_NODE_ID, status: 'failed', error: NODE_FAILURE, durationMs: 88 }],
          },
        },
      });
      await openGroupCanvas(page);
      await clearEndNode(page);
      await runGroup(page);

      const node = page.locator(`[data-id="${QUERY_NODE_ID}"] .query-group-node`);
      await expect(node).toHaveClass(/ran-failed/);
      // The error line is clipped to the node's width in the shot; that clipping
      // is part of what the baseline is for.
      await expect(node.locator('.node-execution-error')).toHaveText(NODE_FAILURE);
      await parkPointer(page);
      await stabilise(page);
      await expect(page).toHaveScreenshot(`canvas-run-failed-${theme}.png`, { fullPage: false });
    });

    test(`canvas — a graph the server will not run`, async ({ page }) => {
      await boot(page, {
        validationResponse: {
          valid: false,
          errors: ['Node has no backend'],
          issues: [
            {
              level: 'error',
              message: 'Node has no backend',
              entityType: 'ExecutionNode',
              entityId: QUERY_NODE_ID,
            },
            {
              level: 'warning',
              message: 'End node output is never written',
              entityType: 'EndNode',
              entityId: END_NODE_ID,
            },
          ],
        },
      });
      await openGroupCanvas(page);
      await clearEndNode(page);
      // Validation is a pre-flight, so the badge arrives on a run that never
      // reaches `/execute` — which is why this one does not wait for a response.
      await page.getByTestId('run-bar-run').click();

      const node = page.locator(`[data-id="${QUERY_NODE_ID}"] .query-group-node`);
      await expect(node).toHaveClass(/has-error/);
      await expect(node.locator('.node-validation-badge')).toBeVisible();
      /*
       * One issue of each severity, so the shot carries both colours in the
       * list. Only the error shows as a badge: the warning names the End node,
       * which is not a `QueryGroupCanvasNode` and draws none — which is itself
       * worth having a picture of, since the list is then the only place that
       * warning appears.
       */
      await expect(page.locator('.validation-issues-panel .validation-issue.error')).toHaveCount(1);
      await expect(page.locator('.validation-issues-panel .validation-issue.warning')).toHaveCount(1);
      /*
       * The issue list is slotted into the Arguments tab, so the panel and the
       * badges it explains are only on screen together there. Worth knowing
       * before reading the shot: this is the app's own arrangement, not a
       * framing choice.
       */
      await page.getByRole('button', { name: 'Arguments', exact: true }).click();
      await expect(page.locator('.validation-issues-panel')).toBeVisible();
      await parkPointer(page);
      await stabilise(page);
      await expect(page).toHaveScreenshot(`canvas-validation-${theme}.png`, { fullPage: false });
    });

    test(`canvas — the argument set a run is made with`, async ({ page }) => {
      await boot(page);
      await openGroupCanvas(page);
      await page.getByRole('button', { name: 'Arguments', exact: true }).click();

      const switcher = page.locator('[data-testid="argument-set-switcher"]');
      await expect(switcher).toBeVisible();
      await switcher.click();
      await page.locator('.set-row').filter({ hasText: ARGUMENT_SET_NAME }).click();
      await expect(switcher).toContainText(ARGUMENT_SET_NAME);
      // The saved set's row, so the shot is of a filled editor rather than of
      // its empty state — the blind spot the shared fixtures were populated to
      // close.
      await expect(page.locator('[data-testid="argument-value"]').first()).toHaveValue(/.+/);
      await parkPointer(page);
      await stabilise(page);
      await expect(page).toHaveScreenshot(`canvas-arguments-${theme}.png`, { fullPage: false });
    });
  });
}
