import { test, expect } from '@playwright/test';
import {
  assignQueryVersionToGroupCanvas,
  bootstrapQueryGroupCanvas,
  createMockState,
  createQueryVersionWithCode,
  executeQueryGroupAndOpenResults,
  GROUP_ID,
  LIBRARY_NAME,
  GROUP_NAME,
  QUERY_NODE_ID,
  selectSidebarQuery,
  selectSidebarQueryGroup,
  SELECT_ALL_SHORTCUT,
  setupMockApi,
  SetupMockApiOptions,
  saveWorkAreaVersion,
} from './query-group-test-helpers';

const NEW_QUERY_NAME = 'Canvas Weather Query';
const SIMPLE_SELECT_QUERY = 'SELECT ?city WHERE { ?city wdt:P31 wd:Q515 } LIMIT 3';
const SIMPLE_CONSTRUCT_QUERY =
  'CONSTRUCT { ?city wdt:P1082 ?population } WHERE { ?city wdt:P31 wd:Q515 ; wdt:P1082 ?population } LIMIT 1';
const SIMPLE_DESCRIBE_QUERY = 'DESCRIBE ?city WHERE { ?city wdt:P31 wd:Q515 } LIMIT 1';

const WEATHER_QUERY_V1 = 'SELECT ?city WHERE { ?city wdt:P31 wd:Q515 } LIMIT 10';
const WEATHER_QUERY_V2 =
  'SELECT ?city ?population WHERE { ?city wdt:P31 wd:Q515 ; wdt:P1082 ?population } LIMIT 5';

/*
 * Revived (#47 item 4) after being `fixme` since the canvas moved on.
 *
 * Two things had drifted, neither of them the mock:
 *
 * 1. **Saving.** "Save Options → Save New Version" is one `SaveBar` button now,
 *    labelled with the version it will create, with the version note prompted
 *    in place — hence `saveWorkAreaVersion`, and `[data-testid="version-pill"]`
 *    instead of a "Version:" combobox that no longer exists.
 * 2. **Selecting a canvas node.** A click at a node's centre lands on its
 *    `.node-toggle`, which stops propagation so opening a node does not also
 *    select it — so `@node-click` never fired and the inspector stayed on
 *    "Nothing selected". That looked like an app regression and was read as one
 *    in the old note here; it is the toggle behaving as written.
 *    `selectQueryNode` now clicks inside the node's corner, clear of the toggle,
 *    and asserts the node ends up selected. The canvas object editor also lives
 *    in the inspector's Editor tab, which the helper opens.
 */
test.describe('Query group canvas integration (mocked)', () => {
  test('adds a query, executes, then updates the group to a new query version', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await createQueryVersionWithCode(page, NEW_QUERY_NAME, WEATHER_QUERY_V1);
    await assignQueryVersionToGroupCanvas(page, NEW_QUERY_NAME);
    await executeQueryGroupAndOpenResults(page);

    await selectSidebarQuery(page, LIBRARY_NAME, NEW_QUERY_NAME);
    const queryEditor = page.locator('.query-work-area .cm-content').first();
    await queryEditor.click();
    await page.keyboard.press(SELECT_ALL_SHORTCUT);
    await page.keyboard.type(WEATHER_QUERY_V2);
    await saveWorkAreaVersion(page, '.query-work-area');
    await expect(page.locator('.query-work-area [data-testid="version-pill"]')).toContainText('v2');

    await assignQueryVersionToGroupCanvas(page, NEW_QUERY_NAME, { versionLabel: '2', expectedGroupVersion: '3' });
  });

  test('executes a SELECT query through the canvas and renders bindings', async ({ page }) => {
    const queryName = 'Canvas SELECT Smoke';
    await bootstrapQueryGroupCanvas(page);
    await createQueryVersionWithCode(page, queryName, SIMPLE_SELECT_QUERY);
    await assignQueryVersionToGroupCanvas(page, queryName);
    await executeQueryGroupAndOpenResults(page);
    await expect(page.getByRole('cell', { name: 'https://example.org/country/1' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '5000000' })).toBeVisible();
  });

  test('executes a CONSTRUCT query and displays RDF triples as a table', async ({ page }) => {
    const queryName = 'Canvas CONSTRUCT Smoke';
    const constructTriples = [
      '<https://example.org/graph/city/1> <http://schema.org/name> "Paris" .',
      '<https://example.org/graph/city/1> <http://schema.org/population> "2148000" .',
    ].join('\n');
    const options: SetupMockApiOptions = {
      executionResponse: {
        contentType: 'application/n-triples',
        body: constructTriples,
      },
    };
    await bootstrapQueryGroupCanvas(page, options);
    await createQueryVersionWithCode(page, queryName, SIMPLE_CONSTRUCT_QUERY);
    await assignQueryVersionToGroupCanvas(page, queryName);
    await executeQueryGroupAndOpenResults(page);
    const graphCell = page.getByRole('cell', { name: 'https://example.org/graph/city/1' }).first();
    await expect(graphCell).toBeVisible();
    // The results table shortens a term whose namespace it knows, so the
    // predicate reads as a CURIE; the subject's example.org namespace has no
    // prefix and stays full-length (with the "+ prefix" affordance beside it).
    await expect(page.getByRole('cell', { name: 'schema:population' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: '2148000' }).first()).toBeVisible();
  });

  test('executes a DESCRIBE query and exposes the raw JSON-LD payload', async ({ page }) => {
    const queryName = 'Canvas DESCRIBE Smoke';
    const describePayload = [
      {
        '@context': {
          name: 'http://schema.org/name',
          population: 'http://schema.org/population',
        },
        '@id': 'https://example.org/city/42',
        '@type': 'http://schema.org/City',
        name: 'Berlin',
        population: 3769000,
      },
    ];
    const options: SetupMockApiOptions = {
      executionResponse: {
        contentType: 'application/ld+json',
        body: describePayload,
      },
    };
    await bootstrapQueryGroupCanvas(page, options);
    await createQueryVersionWithCode(page, queryName, SIMPLE_DESCRIBE_QUERY);
    await assignQueryVersionToGroupCanvas(page, queryName);
    await executeQueryGroupAndOpenResults(page);
    // Table / Raw is one segmented control on the results action bar now.
    const rawView = page.locator('[data-testid="results-view-raw"]');
    await expect(rawView).toBeVisible();
    await rawView.click();
    await expect(rawView).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('application/ld+json')).toBeVisible();
    await expect(page.getByText('Berlin')).toBeVisible();
  });

  /*
   * The two failure paths, which the happy-path specs above could never reach.
   * `useQueryGroupExecution` is unit-tested (test/lib/useQueryGroupExecution.test.ts);
   * what these add is that the canvas and the inspector show what it computed.
   */
  test('refuses to run when validation reports a blocking error, and marks the node', async ({ page }) => {
    const queryName = 'Canvas Invalid Group';
    const options: SetupMockApiOptions = {
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
        ],
      },
    };
    await bootstrapQueryGroupCanvas(page, options);
    await createQueryVersionWithCode(page, queryName, SIMPLE_SELECT_QUERY);
    await assignQueryVersionToGroupCanvas(page, queryName);

    // Nothing may reach /execute: validation is a pre-flight, not a warning.
    let executeCalls = 0;
    page.on('request', (request) => {
      if (request.url().includes('/execute') && request.method() === 'POST') executeCalls += 1;
    });

    await page.getByTestId('run-bar-run').click();

    // The issue named a node, so the canvas says which one. The badge collects
    // every message for that node — the client's own live issues as well as the
    // server's — hence a contains rather than an equals.
    const node = page.locator(`[data-id="${QUERY_NODE_ID}"] .query-group-node`);
    await expect(node).toHaveClass(/has-error/);
    await expect(node.locator('.node-validation-badge')).toHaveAttribute('title', /Node has no backend/);

    // A refused run leaves the inspector where it was — only a run that reaches
    // the server moves it to Results — so the reason is read there deliberately.
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    const results = page.locator('.results-content');
    await expect(results.locator('.empty-state__title')).toHaveText('Execution failed');
    await expect(results.locator('.empty-state__description')).toHaveText(
      'Validation failed. Resolve blocking errors before executing.',
    );
    expect(executeCalls).toBe(0);
  });

  test('shows the node that broke a mid-chain failure, with what ran before it', async ({ page }) => {
    const queryName = 'Canvas Failing Group';
    const options: SetupMockApiOptions = {
      executionResponse: {
        status: 500,
        contentType: 'application/json',
        body: {
          error: 'Node execution failed',
          message: 'Backend refused the query',
          failedNodeId: QUERY_NODE_ID,
          nodes: [
            {
              nodeId: QUERY_NODE_ID,
              status: 'failed',
              error: 'Backend refused the query',
              durationMs: 12,
            },
          ],
        },
      },
    };
    await bootstrapQueryGroupCanvas(page, options);
    await createQueryVersionWithCode(page, queryName, SIMPLE_SELECT_QUERY);
    await assignQueryVersionToGroupCanvas(page, queryName);

    const executeResponse = page.waitForResponse(
      (response) => response.url().includes('/execute') && response.request().method() === 'POST',
    );
    await page.getByTestId('run-bar-run').click();
    await executeResponse;

    const node = page.locator(`[data-id="${QUERY_NODE_ID}"] .query-group-node`);
    await expect(node).toHaveClass(/ran-failed/);
    await expect(node.locator('.node-execution-status')).toHaveText('Failed');

    await page.getByRole('button', { name: 'Results', exact: true }).click();
    const results = page.locator('.results-content');
    await expect(results.locator('.empty-state__title')).toHaveText('Execution failed');
    // The failure the API named, not a generic "something went wrong".
    await expect(results.locator('.empty-state__description')).toHaveText('Node execution failed');
  });

  /*
   * The canvas archetype (#39) draws the empty state as a layer over the flow
   * surface, beside the layer the palette floats in — and a layer that covers
   * the graph has a pointer-events rule to get wrong. So what is worth pinning
   * is not that the call to action appears but that clicking it still reaches
   * the canvas underneath.
   */
  test('the empty canvas offers a first step, and taking it adds a node', async ({ page }) => {
    const state = createMockState();
    const expanded = state.queryGroupExpanded[GROUP_ID][1];
    state.queryGroupExpanded[GROUP_ID][1] = { ...expanded, executionNodes: [], edges: [] };
    await setupMockApi(page, state);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-layout').first()).toBeVisible();
    await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);

    const empty = page.locator('.canvas-surface__empty');
    await expect(empty).toBeVisible();

    const nodes = page.locator('.vue-flow__node');
    const before = await nodes.count();
    await empty.getByRole('button', { name: 'Add your first query' }).click();

    await expect(nodes).toHaveCount(before + 1);
    await expect(empty).toBeHidden();
  });
});
