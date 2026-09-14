import { test, expect, type Page, type Route } from '@playwright/test';

type ExecutionResponse = {
  status: 'converged' | 'cycle' | 'maxIterations' | 'failed';
  iterations: Array<{
    index: number;
    signature: string;
    tripleCount: number;
    delta: number;
    rules: Array<Record<string, unknown>>;
  }>;
  dataBlocks: Array<Record<string, unknown>>;
  finalGraphNQuads?: string | null;
  cycle?: { startIteration: number; endIteration: number } | null;
  maxIterations?: number | null;
};

const defaultLibrary = {
  id: 'urn:sqlib:library:test-lib',
  name: 'Test Library',
  description: 'Library for rule set execution tests',
  defaultBackend: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

/*
 * Rule, in the shape GET /rules returns (`rulesetMembership`, no `comment`).
 * The expanded rule-set version uses a different strict shape — see
 * defaultRuleForExpanded below.
 */
const defaultRule = {
  id: 'urn:sqlib:rule:test',
  name: 'Test Rule',
  description: 'Demo rule for execution tests',
  currentVersion: 'urn:sqlib:rule-version:test-v1',
  isPartOf: [defaultLibrary.id],
  rulesetMembership: ['urn:sqlib:rule-set:test'],
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const defaultRuleForExpanded = {
  id: defaultRule.id,
  name: defaultRule.name,
  description: defaultRule.description,
  comment: null,
  currentVersion: defaultRule.currentVersion,
  isPartOf: defaultRule.isPartOf,
  dateCreated: defaultRule.dateCreated,
  dateModified: defaultRule.dateModified,
};

const defaultRuleVersion = {
  id: defaultRule.currentVersion,
  isPartOf: defaultRule.id,
  version: 1,
  immutable: false,
  comment: null,
  ruleString: 'RULE { ?s <http://example.org/q> ?o } WHERE { ?s <http://example.org/p> ?o }',
  normalizedInsert: null,
  ruleFormat: 'srl',
  grammarType: 'srl',
  grammarValid: true,
  validationError: null,
  grammarValidations: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const defaultRuleSet = {
  id: 'urn:sqlib:rule-set:test',
  name: 'Test RuleSet',
  description: 'Demo ruleset for execution tests',
  isPartOf: [defaultLibrary.id],
  rules: [],
  dataBlocks: [],
  currentVersion: 'urn:sqlib:rule-set-version:test-v1',
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

/*
 * The version carries a rule on purpose: Execute is disabled when the selected
 * version has neither rules nor data blocks, and this fixture used to have
 * both empty — so every execution test sat on a disabled button.
 */
const defaultRuleSetVersion = {
  id: 'urn:sqlib:rule-set-version:test-v1',
  isPartOf: defaultRuleSet.id,
  version: 1,
  comment: null,
  hasRule: [defaultRuleVersion.id],
  hasDataBlock: [],
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

/** The document the rule set exports, and the analysis of it. */
const EXPORTED_SRL = 'PREFIX : <http://example.org/>\n\nRULE { ?s :q ?o } WHERE { ?s :p ?o }\n';

const ANALYSIS = {
  valid: true,
  error: null,
  ruleCount: 1,
  dataBlockCount: 0,
  blocks: [
    {
      kind: 'rule',
      index: 0,
      id: 'rule-1',
      label: ':q',
      name: null,
      startLine: 3,
      endLine: 3,
      stratum: 0,
      monotonicity: 'monotone',
      runOnce: false,
      triples: null,
    },
  ],
  stratification: {
    strata: { 'rule-1': 0 },
    monotonicity: { 'rule-1': 'monotone' },
    runOnce: { 'rule-1': false },
    edges: [],
    issues: [],
    strataCount: 1,
    negationCount: 0,
    runOnceCount: 0,
    stratified: true,
  },
  wellFormedness: [],
};

test.describe('Rule set execution (mocked)', () => {
  let executionResponseStatus: number;
  let executionResponseBody: ExecutionResponse | { error: string };
  let ruleSets: Array<typeof defaultRuleSet>;
  let ruleSetVersions: Map<string, Array<typeof defaultRuleSetVersion>>;

  test.beforeEach(async ({ page }) => {
    executionResponseStatus = 200;
    executionResponseBody = {
      status: 'converged',
      iterations: [
        { index: 0, signature: 'sig-0', tripleCount: 100, delta: 100, rules: [] },
        { index: 1, signature: 'sig-1', tripleCount: 100, delta: 0, rules: [] },
      ],
      dataBlocks: [],
      finalGraphNQuads: null,
      cycle: null,
      maxIterations: null,
    };
    ruleSets = [JSON.parse(JSON.stringify(defaultRuleSet))];
    ruleSetVersions = new Map([[defaultRuleSet.id, [JSON.parse(JSON.stringify(defaultRuleSetVersion))]]]);

    await mockNavigationDependencies(page);

    /*
     * The work area opens on the rule set's document, so it exports one on
     * load and analyzes it on every pause in typing. Without these two the
     * editor is empty and Run is disabled for the wrong reason.
     */
    await page.route('**/rule-sets/*/srl**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          srl: EXPORTED_SRL,
          ruleCount: 1,
          dataBlockCount: 0,
          tupleSeeds: '',
          tuplesEnabled: false,
          warnings: [],
        }),
      });
    });

    await page.route('**/rule-sets/srl/analyze', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ANALYSIS),
      });
    });

    await page.route('**/rule-sets/*/execute', async (route: Route) => {
      await delay(50);
      if (executionResponseStatus >= 400) {
        await route.fulfill({
          status: executionResponseStatus,
          contentType: 'application/json',
          body: JSON.stringify(executionResponseBody),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(executionResponseBody),
      });
    });
    await mockRuleSetApis(page, {
      getRuleSets: () => ruleSets,
      getRuleSetById: (id) => ruleSets.find((entry) => entry.id === id) ?? null,
      getRuleSetVersions: (id) => ruleSetVersions.get(id) ?? [],
    });

    // Not waitForLoadState('networkidle'): against a live dev server the HMR
    // websocket keeps the network busy, so that wait never resolves.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.section-header').filter({ hasText: 'Libraries' })).toBeVisible();
  });

  test('should materialise the rule set and display converged results', async ({ page }) => {
    executionResponseBody = {
      status: 'converged',
      iterations: [
        {
          index: 0,
          signature: 'abc123',
          tripleCount: 100,
          delta: 100,
          rules: [
            {
              ruleVersionId: 'urn:sqlib:rule-version:test',
              programSource: 'normalized',
              durationMs: 45,
              triplesInserted: 50,
              triplesDeleted: 0,
              quadSamples: ['<http://example.org/person1> <http://example.org/type> <http://example.org/Person> .'],
              insertedQuads: ['<http://example.org/person1> <http://example.org/type> <http://example.org/Person> .'],
              deletedQuads: [],
              timedOut: false,
            },
          ],
        },
        {
          index: 1,
          signature: 'abc123',
          tripleCount: 100,
          delta: 0,
          rules: [],
        },
      ],
      dataBlocks: [
        {
          dataBlockVersionId: 'urn:sqlib:data-block-version:test',
          programSource: 'normalized',
          durationMs: 10,
          tripleDelta: 50,
        },
      ],
      finalGraphNQuads: '<http://example.org/s> <http://example.org/p> <http://example.org/o> .\n',
      cycle: null,
      maxIterations: 25,
    };

    await openDefaultRuleSet(page);
    await runExecution(page);

    // Results land in the inspector's Results tab, which the run switches to.
    await expect(page.getByText(/Converged/i)).toBeVisible();
    await expect(page.getByText(/2 iterations/i)).toBeVisible();
    // Per-iteration triple counts are now a signed delta badge, not "N triples".
    await expect(page.locator('.iteration-delta').filter({ hasText: '+100' }).first()).toBeVisible();
  });

  test('should display maxIterations status when convergence not reached', async ({ page }) => {
    executionResponseBody = {
      status: 'maxIterations',
      iterations: Array.from({ length: 25 }, (_, idx) => ({
        index: idx,
        signature: `sig-${idx}`,
        tripleCount: 100 + idx,
        delta: idx === 0 ? 100 : 4,
        rules: [],
      })),
      dataBlocks: [],
      finalGraphNQuads: null,
      cycle: null,
      maxIterations: 25,
    };

    await openDefaultRuleSet(page);
    await runExecution(page);

    await expect(page.getByText(/Maximum iterations reached/i)).toBeVisible();
    await expect(page.getByText(/limit of 25 iterations/i)).toBeVisible();
  });

  test('should display cycle detection results', async ({ page }) => {
    executionResponseBody = {
      status: 'cycle',
      iterations: [
        { index: 5, signature: 'sig-5', tripleCount: 140, delta: 20, rules: [] },
        { index: 6, signature: 'sig-6', tripleCount: 155, delta: 15, rules: [] },
        { index: 7, signature: 'sig-7', tripleCount: 155, delta: 0, rules: [] },
        { index: 8, signature: 'sig-5', tripleCount: 140, delta: -15, rules: [] },
      ],
      dataBlocks: [],
      finalGraphNQuads: null,
      cycle: { startIteration: 5, endIteration: 8 },
      maxIterations: null,
    };

    await openDefaultRuleSet(page);
    await runExecution(page);

    await expect(page.getByText(/Cycle detected/i)).toBeVisible();
    await expect(page.getByText(/iteration 8 matched iteration 5/i)).toBeVisible();
  });

  test('should display execution errors', async ({ page }) => {
    executionResponseStatus = 500;
    // The client reads the `error` key off a failed response, not `message`.
    executionResponseBody = { error: 'SPARQL syntax error in rule' };

    await openDefaultRuleSet(page);
    await runExecution(page);

    await expect(page.getByText(/SPARQL syntax error/i)).toBeVisible();
  });

  test('should disable Run while a run is in flight', async ({ page }) => {
    executionResponseBody = {
      status: 'converged',
      iterations: [],
      dataBlocks: [],
      finalGraphNQuads: null,
      cycle: null,
      maxIterations: null,
    };

    await openDefaultRuleSet(page);
    const runButton = page.locator('[data-testid="run-bar-run"]');
    await runButton.click();

    await expect(runButton).toContainText(/Running/i);
    await expect(runButton).toBeDisabled();

    await expect(runButton).toContainText(/^Run$/);
    await expect(runButton).toBeEnabled();
  });

  async function runExecution(page: Page) {
    const runButton = page.locator('[data-testid="run-bar-run"]');
    await runButton.click();

    await expect(runButton).toContainText(/Running/i);
    await expect(runButton).toContainText(/^Run$/);
  }

  async function openDefaultRuleSet(page: Page) {
    await openRuleSetFromSidebar(page, defaultLibrary.name, defaultRuleSet.name);
  }

  /**
   * `expandedSections.libraries` defaults to true, so the section toggle is NOT
   * clicked — doing so collapses the list and the items never appear. Individual
   * libraries and their categories do start collapsed.
   *
   * Waits are auto-retrying expects rather than bare clicks: the section header
   * renders before the library list has been fetched.
   */
  async function openRuleSetFromSidebar(page: Page, libraryName: string, ruleSetName: string) {
    const libraryToggle = page.locator('.library-item .library-toggle', { hasText: libraryName });
    await expect(libraryToggle).toBeVisible();
    await libraryToggle.click();

    const ruleSetsCategory = page.locator('.library-subitems .category-header', { hasText: 'Rule Sets' });
    await expect(ruleSetsCategory).toBeVisible();
    await ruleSetsCategory.click();

    const ruleSetButton = page.locator('.library-subitems .item-button', { hasText: ruleSetName });
    await expect(ruleSetButton).toBeVisible();
    await ruleSetButton.click();

    await expect(page.locator('.ruleset-work-area')).toBeVisible();
  }
});

async function mockNavigationDependencies(page: Page) {
  await page.route('**/libraries', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([defaultLibrary]),
    });
  });

  await page.route('**/queries', fulfillWithJson([]));
  await page.route('**/query-groups', fulfillWithJson([]));
  await page.route('**/data-blocks', fulfillWithJson([]));
  await page.route('**/backends', fulfillWithJson([]));

  // The rule set's version references a rule version, and the work area
  // resolves it by listing rules and matching currentVersion. With /rules
  // empty that lookup fails, no rules load, and Execute stays disabled.
  await page.route('**/rules', fulfillWithJson([defaultRule]));
  await page.route('**/rules/*/versions', fulfillWithJson([defaultRuleVersion]));
  await page.route('**/rules/*/versions/*', fulfillWithJson(defaultRuleVersion));
}

async function mockRuleSetApis(
  page: Page,
  options: {
    getRuleSets: () => Array<typeof defaultRuleSet>;
    getRuleSetById: (id: string) => typeof defaultRuleSet | null | undefined;
    getRuleSetVersions: (id: string) => Array<typeof defaultRuleSetVersion>;
  },
) {
  await page.route('**/rule-sets', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(options.getRuleSets()),
      });
      return;
    }
    await route.fulfill({ status: 405 });
  });

  await page.route('**/rule-sets/*/versions', async (route: Route) => {
    const url = new URL(route.request().url());
    // /rule-sets/{id}/versions -> ['rule-sets', id, 'versions']. This read
    // segments[2] ('versions'), so the id never matched, the version list came
    // back empty, and Execute was disabled for the wrong reason.
    const segments = url.pathname.split('/').filter(Boolean);
    const ruleSetId = segments[1] ? decodeURIComponent(segments[1]) : '';
    const versions = options.getRuleSetVersions(ruleSetId);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(versions),
    });
  });

  // The work area also fetches the selected version's detail. Registered after
  // the list handler because Playwright matches routes last-registered-first,
  // and the '**/versions' pattern also matches '**/versions/1' — without this
  // the detail request is served an array, no version is selected, and Execute
  // stays disabled.
  await page.route('**/rule-sets/*/versions/*', async (route: Route) => {
    const url = new URL(route.request().url());
    // /rule-sets/{id}/versions/{n} -> ['rule-sets', id, 'versions', n]
    const segments = url.pathname.split('/').filter(Boolean);
    const ruleSetId = segments[1] ? decodeURIComponent(segments[1]) : '';
    const requested = Number(segments[3]);
    const match = options.getRuleSetVersions(ruleSetId).find((v) => Number(v.version) === requested);
    if (!match) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
      return;
    }
    // GET /rule-sets/:id/versions/:n returns the expanded shape
    // ({ ruleSetVersion, rules, dataBlocks }), not the bare version. Returning
    // the bare version fails the client's schema parse, no version is selected,
    // and Execute stays disabled.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: '"test-etag"' },
      body: JSON.stringify({
        ruleSetVersion: match,
        rules: (match.hasRule ?? []).map(() => ({ ruleVersion: defaultRuleVersion, rule: defaultRuleForExpanded })),
        dataBlocks: [],
      }),
    });
  });

  await page.route('**/rule-sets/*', async (route: Route) => {
    const url = new URL(route.request().url());
    const ruleSetId = decodeURIComponent(url.pathname.split('/').slice(-1)[0]);
    const entity = options.getRuleSetById(ruleSetId);
    if (!entity) {
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: '"test-etag"' },
      body: JSON.stringify(entity),
    });
  });
}

function fulfillWithJson<T>(payload: T) {
  return async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
