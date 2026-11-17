import { test, expect, type Page, type Route } from '@playwright/test';
import {
  mockEntityApi,
  BACKEND,
  BENCHMARK_EXPERIMENT,
  BENCHMARK_RUN,
  BENCHMARK_VERSION,
  QUERY,
  QUERY_GROUP,
  QUERY_GROUP_VERSION_EXPANDED,
  QUERY_VERSION,
  type MockOptions,
} from './fixtures/entities';

/*
 * A query group case lists the group's nodes in run order, each with the
 * backend it runs on and its p95 from the run in view. The plan's backends do
 * not apply to a group case.
 *
 * Set BENCH_GROUP_SHOTS to a directory to also write the screenshots the pull
 * request shows.
 */

const SHOTS = process.env.BENCH_GROUP_SHOTS ?? '';
const RULE_NODE = 'urn:sqlib:rule-set-node:bench';
const RULE_SET_VERSION = 'urn:sqlib:rule-set-version:bench';
const QUERY_NODE = QUERY_GROUP_VERSION_EXPANDED.executionNodes[0]!.id;
const END_NODE = QUERY_GROUP_VERSION_EXPANDED.endNode.id;

const fulfill = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/* The fixture group, with a labelled query node and a rule set node after it. */
const GROUP_EXPANDED = {
  ...QUERY_GROUP_VERSION_EXPANDED,
  queryGroupVersion: {
    ...QUERY_GROUP_VERSION_EXPANDED.queryGroupVersion,
    canvasData: JSON.stringify({ nodes: [{ id: QUERY_NODE, label: 'Find countries' }] }),
  },
  executionNodes: [
    ...QUERY_GROUP_VERSION_EXPANDED.executionNodes,
    {
      id: RULE_NODE,
      inputs: [],
      outputs: [],
      ruleSetVersion: RULE_SET_VERSION,
      nodeType: 'RuleSetNode',
      dateCreated: '2026-01-01T00:00:00Z',
      dateModified: '2026-01-01T00:00:00Z',
    },
  ],
  edges: [
    ...QUERY_GROUP_VERSION_EXPANDED.edges,
    { id: 'urn:sqlib:edge:bench-rules', sourceNodeId: QUERY_NODE, targetNodeId: RULE_NODE, dataFlowType: 'CONTROL_FLOW' },
    { id: 'urn:sqlib:edge:bench-end', sourceNodeId: RULE_NODE, targetNodeId: END_NODE, dataFlowType: 'CONTROL_FLOW' },
  ],
  iriMap: { [QUERY_VERSION.id]: QUERY.name, [RULE_SET_VERSION]: 'Region rules' },
};

const VERSION = {
  ...BENCHMARK_VERSION,
  immutable: false,
  subjectSpecs: [
    { subject: QUERY_VERSION.id, inputs: [], backends: [BACKEND.id] },
    { subject: QUERY_GROUP.currentVersion, inputs: [] },
  ],
};

const NODE_OBSERVATIONS = [12, 14, 30].map((durationMs, runIndex) => ({
  id: `urn:sqlib:benchmark-node-observation:${runIndex}`,
  dataSet: BENCHMARK_RUN.id,
  groupObservation: 'urn:sqlib:benchmark-observation:visual-0',
  node: QUERY_NODE,
  backend: BACKEND.id,
  runIndex,
  nodeIndex: 2,
  durationMs,
  resultCount: 3,
  success: true,
  timestamp: '2026-01-02T10:00:01Z',
}));

const OPTIONS: MockOptions = {
  extraRoutes: [
    [/\/benchmark-experiments\/runs\/[^/]+\/node-observations$/, (r) => fulfill(r, NODE_OBSERVATIONS)],
    [/\/benchmark-experiments\/[^/]+\/versions\/\d+$/, (r) => fulfill(r, VERSION)],
    [/\/benchmark-experiments\/[^/]+\/versions$/, (r) => fulfill(r, [VERSION])],
    [/\/query-groups\/[^/]+\/versions\/\d+$/, (r) => fulfill(r, GROUP_EXPANDED)],
  ],
};

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openGroupCase(page: Page) {
  await mockEntityApi(page, OPTIONS);
  await page.goto(`/?section=benchmarks&benchmark=${encodeURIComponent(BENCHMARK_EXPERIMENT.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  const sidebar = page.getByTestId('benchmark-plan-sidebar');
  await expect(sidebar).toBeVisible();
  await sidebar.getByText(QUERY_GROUP.name).click();
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`benchmark group nodes (${colorScheme})`, () => {
    test.use({ colorScheme, viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });

    test('lists the nodes in run order with their backends and timings', async ({ page }) => {
      await openGroupCase(page);

      const rows = page.getByTestId('benchmark-group-node');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText('Find countries');
      await expect(rows.nth(0)).toContainText(QUERY.name);
      await expect(rows.nth(0)).toContainText(BACKEND.name);
      await expect(rows.nth(0)).toContainText('3 req');
      await expect(rows.nth(1)).toContainText('Region rules');
      await expect(rows.nth(1)).toContainText('In-process');

      // The first node with text is shown, with a link to its query.
      await expect(page.getByTestId('benchmark-case-query')).toContainText('SELECT');
      await expect(page.getByTestId('benchmark-open-node')).toHaveAttribute('href', /\/queries\//);
      await shoot(page, `group-nodes-${colorScheme}`);
    });

    test('a query case names its query and links to it', async ({ page }) => {
      await openGroupCase(page);
      await page.getByTestId('benchmark-plan-sidebar').getByText(QUERY.name).first().click();
      await expect(page.getByTestId('benchmark-case-entity')).toContainText(QUERY.name);
      const link = page.getByTestId('benchmark-open-target');
      await expect(link).toHaveText('Open query');
      await shoot(page, `query-case-${colorScheme}`);
      await link.click();
      await expect(page).toHaveURL(/\/queries\//);
    });
  });
}

test('the plan list and the inspector resize from their edges', async ({ page }) => {
  await openGroupCase(page);
  const sidebar = page.getByTestId('benchmark-plan-sidebar');
  const before = (await sidebar.boundingBox())!.width;
  const edge = (await sidebar.getByTestId('sidebar-resizer').boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
  await page.mouse.down();
  await page.mouse.move(edge.x + 120, edge.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(before + 80);

  const inspector = page.getByTestId('benchmark-inspector');
  const inspectorBefore = (await inspector.boundingBox())!.width;
  const handle = (await page.getByTestId('benchmark-inspector-resizer').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x - 150, handle.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBeGreaterThan(inspectorBefore + 100);
});
