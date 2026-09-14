/**
 * The run screen's output panes must be readable.
 *
 * Result and Expected once painted `--code-surface` — the embedded editors'
 * dark chrome — and let `color` inherit, which in the light theme is near-black
 * `--ink`. Both rendered at 1.15:1: a filled rectangle with the run's output
 * invisible inside it.
 *
 * Asserting the contrast rather than a colour keeps the check about the thing
 * that matters. Either token may move in a retheme, and the panes have since
 * changed twice — first to plain `pre` blocks, now to `CodePeek` editors — so
 * what is asserted is the rendered text against whatever is painted behind it.
 * A surface paired with ink it cannot be read against is what must not come
 * back, however the panes are built.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { mockSidebarCollections } from './fixtures/collections';
import { textContrast } from './contrast';

const library = {
  id: 'urn:sqlib:library:run-contrast',
  name: 'Run Contrast Library',
  description: null,
  defaultBackend: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const ruleSet = {
  id: 'urn:sqlib:rule-set:run-contrast',
  name: 'Run Contrast Rule Set',
  description: null,
  currentVersion: 'urn:sqlib:rule-set-version:run-contrast-v1',
  isPartOf: [library.id],
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const testEntity = {
  id: 'urn:sqlib:test:run-contrast',
  name: 'Run Contrast Test',
  description: null,
  subject: ruleSet.id,
  subjectKind: 'ruleSet',
  currentVersion: 'urn:sqlib:test-version:run-contrast-v1',
  currentVersionNumber: 1,
  isPartOf: [library.id],
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const testVersion = {
  id: testEntity.currentVersion,
  isPartOf: testEntity.id,
  version: 1,
  immutable: false,
  expectationKind: 'graph',
  cases: [
    {
      id: 'urn:sqlib:test-case:run-contrast-1',
      isPartOf: testEntity.currentVersion,
      position: 0,
      name: 'Case one',
      argumentSetVersion: null,
      dataGraphVersion: null,
      tupleSeeds: null,
      expected: '<http://example/a> <http://example/reaches> <http://example/b> .',
      expectedFormat: 'text/turtle',
      ordered: false,
      dateCreated: '2024-01-01T00:00:00Z',
      dateModified: '2024-01-01T00:00:00Z',
    },
  ],
  subjectVersion: null,
  backend: null,
  maxIterations: null,
  timeoutMs: null,
  comment: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

/*
 * A failing run, because it is the shape that fills the pane: a pass with no
 * diff would leave Difference unrendered and test less of the column.
 */
const runResult = {
  testId: testEntity.id,
  testVersionId: testVersion.id,
  passed: false,
  message: 'Graphs differ: 1 expected only, 1 actual only',
  expectationKind: 'graph',
  hermetic: true,
  durationMs: 42,
  subjectVersionId: ruleSet.currentVersion,
  ranAt: '2024-01-02T00:00:00Z',
  passedCount: 0,
  failedCount: 1,
  cases: [
    {
      caseId: testVersion.cases[0].id,
      name: 'Case one',
      position: 0,
      passed: false,
      message: 'Graphs differ',
      detail: {
        missing: ['<http://example/a> <http://example/reaches> <http://example/b> .'],
        unexpected: ['<http://example/a> <http://example/reaches> <http://example/c> .'],
        matched: 3,
      },
      result: '<http://example/a> <http://example/reaches> <http://example/c> .',
      resultTruncated: false,
      durationMs: 42,
    },
  ],
};

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockTestScreen(page: Page) {
  await mockSidebarCollections(page, { libraries: [library], ruleSets: [ruleSet] });

  // Registered narrow-to-wide in reverse: the most recent handler wins, so the
  // run route must come after the collection and detail ones.
  await page.route('**/tests*', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await json(route, [testEntity]);
  });
  await page.route('**/tests/*', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await json(route, testEntity);
  });
  await page.route('**/tests/*/versions', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await json(route, [testVersion]);
  });
  await page.route('**/tests/*/run', async (route: Route) => json(route, runResult));
  await page.route('**/rule-sets/*/versions*', async (route: Route) => json(route, []));
  await page.route('**/data-graphs*', async (route: Route) => json(route, []));
  await page.route('**/argument-sets*', async (route: Route) => json(route, []));
}

test.describe('Test run result legibility', () => {
  test('the result and expected panes read against their own surface', async ({ page }) => {
    await mockTestScreen(page);
    await page.goto(`/?section=tests&test=${encodeURIComponent(testEntity.id)}`);

    await page.getByTestId('run-bar-run').click();
    await expect(page.getByTestId('test-verdict')).toBeVisible();
    await expect(page.getByTestId('test-result')).toBeVisible();

    // Both panes are CodePeeks over CodeMirror: Result, then Expected. They
    // are the Runs tab's screen now — running from the test lands on it.
    await expect(page.getByTestId('test-run-detail')).toBeVisible();
    const panes = page.locator('[data-testid="test-run-detail"] .code-peek .cm-line');
    expect(await panes.count()).toBeGreaterThanOrEqual(2);

    for (let index = 0; index < 2; index += 1) {
      // WCAG AA for body text. The bug shipped at 1.15.
      expect(await textContrast(page, '[data-testid="test-run-detail"] .code-peek .cm-line', index))
        .toBeGreaterThan(4.5);
    }
  });
});
