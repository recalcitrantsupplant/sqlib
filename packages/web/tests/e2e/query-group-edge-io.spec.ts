import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapQueryGroupCanvas,
  CONTROL_EDGE_ID,
  DATA_EDGE_ID,
  GROUP_NAME,
  LIBRARY_NAME,
  NODE_INPUT_PORT,
  OUTPUT_EDGE_ID,
  openCanvasEditorTab,
  saveQueryGroupNewVersion,
  selectCanvasEdge,
  selectSidebarQueryGroup,
  START_TUPLE_PORT,
  type SetupMockApiOptions,
} from './query-group-test-helpers';

/*
 * Edge I/O mapping and flow-type switching (#47 item 4).
 *
 * The execution specs next door drive a group end to end; nothing until now
 * looked at the edges, which is where a group says what travels between two
 * nodes. The seeded group is built for exactly this: the start node reaches the
 * query node twice — once as CONTROL_FLOW and once as VARIABLE_BINDINGS
 * carrying a two-variable tuple — and the query node reaches the end node as
 * RDF_GRAPH, so all three shapes the inspector draws differently are present
 * without a spec having to author one.
 *
 * The command layer is unit-tested (`test/lib/queryGroupCommands.test.ts` and
 * friends); what these add is that the inspector shows what it computed, and
 * that an edit to an edge reaches the payload and comes back out of it.
 */

const openGroupCanvas = async (page: Page) => {
  await selectSidebarQueryGroup(page, LIBRARY_NAME, GROUP_NAME);
  await page.locator('.vue-flow__node').first().waitFor();
  await openCanvasEditorTab(page);
};

const editor = (page: Page) => page.locator('.canvas-editor');
const flowSelect = (page: Page) => page.locator('#edge-flow-select');
const whenEmptySelect = (page: Page) => page.locator('#edge-when-empty');
const mappingSection = (page: Page) => page.locator('.tuple-mapping-section');
/** One `<select>` per target variable, in the order the grid lists them. */
const mappingSelects = (page: Page) => page.locator('.mapping-column-source .mapping-select');

/** The row that stands in for the grid when it is closed, which is by default. */
const mappingSummary = (page: Page) => editor(page).locator('[data-testid="mapping-summary"]');

/**
 * Open the positional grid, the way an author has to.
 *
 * The grid is collapsed behind its summary, so a spec that wants the selects
 * asks for them rather than finding them already on screen — and asks only
 * once, since the disclosure is sticky across edge selections.
 */
const expandMapping = async (page: Page) => {
  const summary = mappingSummary(page);
  await summary.waitFor();
  if ((await summary.getAttribute('aria-expanded')) === 'false') await summary.click();
  await editor(page).locator('#variable-mapping-details').waitFor();
};

/** The POST that creates the next group version, with the draft as its body. */
const versionCreateRequest = (page: Page) =>
  page.waitForRequest(
    (request) => request.method() === 'POST' && /\/query-groups\/[^/]+\/v$/.test(new URL(request.url()).pathname),
  );

test.describe('Query group edge I/O (mocked)', () => {
  test('reads a data edge as a tuple mapping between two named ports', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await selectCanvasEdge(page, DATA_EDGE_ID);

    await expect(editor(page).locator('.panel-header__subtitle')).toHaveText(DATA_EDGE_ID);
    await expect(flowSelect(page)).toHaveValue('VARIABLE_BINDINGS');

    // The ports it is bound to, by the names the group gave them rather than
    // the IRIs it stores — which the summary shows underneath.
    await expect(mappingSection(page).getByText('Tuple Mapping')).toBeVisible();
    await expect(page.locator('#source-output-select')).toContainText('Start Params');
    await expect(page.locator('#target-input-select')).toContainText('City Params');
    await expect(editor(page).locator('.summary-subvalue').first()).toContainText(START_TUPLE_PORT);
    await expect(editor(page).locator('.summary-subvalue').last()).toContainText(NODE_INPUT_PORT);

    // Both tuples carry two variables, so nothing here is a mismatch to warn
    // about — an edge the author has no work left to do on.
    await expect(editor(page).locator('[data-testid="mapping-arity-warning"]')).toBeHidden();
    await expect(editor(page).locator('[data-testid="edge-diagnostic"]')).toHaveCount(0);
    await expect(editor(page).locator('.tuple-warning')).toHaveCount(0);

    // Only a bindings edge has an empty-input policy to set: "what if there
    // are no rows" is not a question the other flow types can be asked.
    await expect(whenEmptySelect(page)).toBeVisible();
  });

  test('names every target variable and what feeds it', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await selectCanvasEdge(page, DATA_EDGE_ID);

    const visualization = editor(page).locator('.tuple-mapping-visualization');

    /*
     * Said on the closed summary first, because that is the whole of what an
     * author sees until they ask for more. The line is the same fact the grid
     * below spells out over two rows and four columns: `city` exists on both
     * sides so it pairs itself, and `region` — which the source does not have —
     * is left UNDEF rather than guessed at from position.
     */
    await expect(visualization.locator('[data-testid="mapping-summary-line"]'))
      .toHaveText('?city UNDEF → ?city ?region');
    // Nothing the compatibility rules object to, and the summary says so.
    await expect(mappingSummary(page)).toHaveAttribute('data-mapping-state', 'ok');
    await expect(visualization.locator('.mapping-subtitle')).toHaveText('mapped');

    await expandMapping(page);
    await expect(visualization.locator('.variable-group-target .variable-badge')).toHaveText(['?city', '?region']);
    await expect(mappingSelects(page).first()).toHaveValue('city');
    await expect(mappingSelects(page).last()).toHaveValue('');
    await expect(mappingSelects(page).last().locator('option')).toHaveText(['UNDEF', '?city', '?country']);
  });

  test('keeps the grid closed until it is asked for, and then keeps it open', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await selectCanvasEdge(page, DATA_EDGE_ID);

    await expect(editor(page).locator('#variable-mapping-details')).toBeHidden();
    await expect(mappingSummary(page)).toHaveAttribute('aria-expanded', 'false');

    await mappingSummary(page).click();
    await expect(editor(page).locator('#variable-mapping-details')).toBeVisible();

    /*
     * Still open on the way back. "Show me the positions" is how an author is
     * working rather than a fact about one edge, so walking a graph's edges
     * does not mean opening the same drawer at each of them — and the control
     * edge in between has no mapping section at all, which is the case that
     * would lose the state if it were stored per selection.
     */
    await selectCanvasEdge(page, CONTROL_EDGE_ID);
    await expect(editor(page).locator('.tuple-mapping-visualization')).toBeHidden();
    await selectCanvasEdge(page, DATA_EDGE_ID);
    await expect(mappingSummary(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(editor(page).locator('#variable-mapping-details')).toBeVisible();

    await mappingSummary(page).click();
    await expect(editor(page).locator('#variable-mapping-details')).toBeHidden();
  });

  test('a chosen variable mapping reaches the saved version and comes back with it', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await selectCanvasEdge(page, DATA_EDGE_ID);

    const createVersion = versionCreateRequest(page);
    await expandMapping(page);
    await mappingSelects(page).last().selectOption('country');
    await saveQueryGroupNewVersion(page);

    const payload = (await createVersion).postDataJSON();
    const savedEdge = payload.edges.find((edge: { id: string }) => edge.id === DATA_EDGE_ID);
    expect(JSON.parse(savedEdge.variableMappings)).toEqual([
      { source: 'city', target: 'city' },
      { source: 'country', target: 'region' },
    ]);

    await expect(page.locator('.querygroup-work-area [data-testid="version-pill"]')).toContainText('v2');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await openGroupCanvas(page);
    await selectCanvasEdge(page, DATA_EDGE_ID);

    // The reload is the point of the assertion, so it is made on the row that
    // is visible after one: ?region is fed by ?country now, and the author can
    // see that without opening anything.
    await expect(editor(page).locator('[data-testid="mapping-summary-line"]'))
      .toHaveText('?city ?country → ?city ?region');

    await expandMapping(page);
    await expect(mappingSelects(page).last()).toHaveValue('country');
  });

  test('an empty-input policy reaches the saved version and comes back with it', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await selectCanvasEdge(page, DATA_EDGE_ID);

    const createVersion = versionCreateRequest(page);
    await whenEmptySelect(page).selectOption('require');
    await saveQueryGroupNewVersion(page);

    const payload = (await createVersion).postDataJSON();
    const savedEdge = payload.edges.find((edge: { id: string }) => edge.id === DATA_EDGE_ID);
    expect(savedEdge.whenEmpty).toBe('require');

    await expect(page.locator('.querygroup-work-area [data-testid="version-pill"]')).toContainText('v2');

    /*
     * And back out again. Reaching the payload is only half of it: `whenEmpty`
     * went missing from the draft schema once already (fixed with a unit
     * regression test), and a save that stores nothing looks identical in the
     * UI until the page is reloaded.
     */
    await page.reload();
    await page.waitForLoadState('networkidle');
    await openGroupCanvas(page);
    await selectCanvasEdge(page, DATA_EDGE_ID);
    await expect(whenEmptySelect(page)).toHaveValue('require');
  });

  test('a control edge carries no ports until its flow type carries data', async ({ page }) => {
    await bootstrapQueryGroupCanvas(page);
    await openGroupCanvas(page);
    await selectCanvasEdge(page, CONTROL_EDGE_ID);

    await expect(flowSelect(page)).toHaveValue('CONTROL_FLOW');
    await expect(mappingSection(page)).toBeHidden();
    await expect(whenEmptySelect(page)).toBeHidden();

    await flowSelect(page).selectOption('VARIABLE_BINDINGS');

    /*
     * Switching flow type binds the endpoints rather than leaving the author to
     * find them: each node offers exactly one tuple port here, so
     * `resolveEndpoints` picks it. Worth pinning — an edge that arrives unbound
     * reads as broken on a canvas that could have answered the question itself.
     */
    await expect(mappingSection(page)).toBeVisible();
    await expect(page.locator('#source-output-select')).toContainText('Start Params');
    await expect(page.locator('#target-input-select')).toContainText('City Params');
    await expect(whenEmptySelect(page)).toBeVisible();

    // The canvas relabels the edge, so the change is legible without the
    // inspector open. Both edges now carry rows, hence two labels.
    await expect(page.locator('.edge-label').filter({ hasText: 'result rows' })).toHaveCount(2);

    const createVersion = versionCreateRequest(page);
    await saveQueryGroupNewVersion(page);
    const payload = (await createVersion).postDataJSON();
    const savedEdge = payload.edges.find((edge: { id: string }) => edge.id === CONTROL_EDGE_ID);
    expect(savedEdge.dataFlowType).toBe('VARIABLE_BINDINGS');
    expect(savedEdge.sourceOutputId).toBe(START_TUPLE_PORT);
    expect(savedEdge.targetInputId).toBe(NODE_INPUT_PORT);
  });

  test('a validation issue naming an edge selects it, and the end node takes its source as-is', async ({ page }) => {
    /*
     * The edge into the end node cannot be clicked: the ranked layout puts the
     * two nodes close enough that they cover the whole line. Reaching it
     * through the issue that names it is the route the app provides — and the
     * jump from a listed issue to the element it is about is worth a test of
     * its own, since only a run brings the server's issues back.
     */
    const options: SetupMockApiOptions = {
      validationResponse: {
        valid: true,
        warnings: ['The group returns triples, which the End node renders as a table.'],
        issues: [
          {
            level: 'warning',
            message: 'The group returns triples, which the End node renders as a table.',
            entityType: 'QueryEdge',
            entityId: OUTPUT_EDGE_ID,
            code: 'end-node-media-type',
          },
        ],
      },
    };
    await bootstrapQueryGroupCanvas(page, options);
    await openGroupCanvas(page);

    const executeResponse = page.waitForResponse(
      (response) => response.url().includes('/execute') && response.request().method() === 'POST',
    );
    await page.getByTestId('run-bar-run').click();
    await executeResponse;

    // The issue list hangs off the Arguments tab; a run leaves the inspector on
    // Results, so the list has to be opened before its links can be used.
    await page.getByRole('button', { name: 'Arguments', exact: true }).click();
    const issueLink = page.locator('.validation-issue-link').filter({
      hasText: 'The group returns triples',
    });
    await expect(issueLink).toBeVisible();
    await issueLink.click();

    await expect(editor(page).locator('.panel-header__subtitle')).toHaveText(OUTPUT_EDGE_ID);
    await expect(flowSelect(page)).toHaveValue('RDF_GRAPH');
    await expect(page.locator('#source-output-select')).toContainText('City RDF');
    // No target input to pick: the end node takes whatever the source produces.
    await expect(page.locator('#target-input-select')).toBeHidden();
    await expect(editor(page).locator('.end-node-info')).toContainText(
      'the output is automatically passed through as the final result',
    );
    // An RDF edge carries no rows, so it has no empty-input policy either.
    await expect(whenEmptySelect(page)).toBeHidden();
  });
});
