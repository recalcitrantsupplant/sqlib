import { test, expect, type Page, type Route } from '@playwright/test';
import { openSection } from './navigate';

/**
 * Authoring a rule set as one SRL document.
 *
 * Navigation and entity reads are mocked (as in the sibling ruleset specs), but
 * the SRL endpoints are exercised as real request/response round-trips so the
 * request bodies and rendered results are genuinely asserted.
 *
 * The screen is the query shell: a save bar over the document, a status
 * strip under it, and the derived views — outline, stratification, SPARQL — in
 * the right-hand tabs. `/rule-sets/srl/analyze` is what feeds all three, so it
 * is mocked here as carefully as the routes that write.
 */

const defaultLibrary = {
  id: 'urn:sqlib:library:test-lib',
  name: 'Test Library',
  description: 'Library for SRL authoring tests',
  defaultBackend: null,
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const defaultRuleSet = {
  id: 'urn:sqlib:rule-set:srl-test',
  name: 'SRL RuleSet',
  description: 'Ruleset used for SRL document authoring tests',
  isPartOf: [defaultLibrary.id],
  rules: [],
  dataBlocks: [],
  currentVersion: 'urn:sqlib:rule-set-version:srl-test-v1',
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const defaultRuleSetVersion = {
  id: 'urn:sqlib:rule-set-version:srl-test-v1',
  isPartOf: defaultRuleSet.id,
  version: 1,
  comment: null,
  hasRule: [],
  hasDataBlock: [],
  dateCreated: '2024-01-01T00:00:00Z',
  dateModified: '2024-01-01T00:00:00Z',
};

const EXPORTED_SRL = 'PREFIX : <http://example.org/>\n\nRULE { ?s :q ?o } WHERE { ?s :p ?o }\n';

type PreviewBody = {
  warnings: string[];
  created: Array<{ label: string; named: boolean; text: string }>;
  updated: Array<{ ruleVersionId: string; changed: boolean; text: string }>;
  detached: Array<{ ruleVersionId: string; ruleId: string; otherRuleSets: number; orphaned: boolean }>;
  unchangedCount: number;
  data: {
    created: Array<{ label: string; text: string }>;
    unchangedCount: number;
    detached: Array<{ dataBlockVersionId: string; otherRuleSets: number; orphaned: boolean }>;
  };
  tupleSeeds: { rows: number; declarations: Array<{ arity: number; terms: string[] }> };
};

/** The parts of a preview response every case carries. */
const emptyPreview = (): PreviewBody => ({
  warnings: [],
  created: [],
  updated: [],
  detached: [],
  unchangedCount: 0,
  data: { created: [], unchangedCount: 0, detached: [] },
  tupleSeeds: { rows: 0, declarations: [] },
});

type AnalysisBlock = {
  kind: 'rule' | 'data';
  index: number;
  id: string;
  label: string;
  name: string | null;
  startLine: number;
  endLine: number;
  stratum: number | null;
  monotonicity: 'monotone' | 'negation' | null;
  runOnce: boolean | null;
  triples: number | null;
};

/** One valid rule, which is what the exported fixture document contains. */
const defaultAnalysis = () => ({
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
    } satisfies AnalysisBlock,
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
});

test.describe('Rule set SRL authoring', () => {
  let previewStatus: number;
  let previewBody: PreviewBody | { error: string };
  let importStatus: number;
  let importBody: Record<string, unknown> | { error: string };
  let lastPreviewRequest: Record<string, unknown> | null;
  let lastImportRequest: Record<string, unknown> | null;
  let lastPreviewContentType: string | undefined;
  let lastImportContentType: string | undefined;
  let exportedSrl: string;
  let exportedTupleSeeds: string;
  let exportedTuplesEnabled: boolean;
  let lastCompileRequest: Record<string, unknown> | null;
  let compileBody: Record<string, unknown>;
  let analysisBody: Record<string, unknown>;

  test.beforeEach(async ({ page }) => {
    previewStatus = 200;
    previewBody = emptyPreview();
    importStatus = 200;
    importBody = {
      ruleSetVersionId: 'urn:sqlib:rule-set-version:srl-test-v2',
      version: 2,
      created: [],
      updated: [],
      detached: [],
      ruleCount: 1,
      dataCreated: [],
      dataDetached: [],
      dataBlockCount: 0,
      tuplesEnabled: false,
    };
    lastPreviewRequest = null;
    lastImportRequest = null;
    lastPreviewContentType = undefined;
    lastImportContentType = undefined;
    exportedSrl = EXPORTED_SRL;
    exportedTupleSeeds = '';
    exportedTuplesEnabled = false;
    lastCompileRequest = null;
    compileBody = { rules: [], dataBlocks: [], flavour: 'insert' };
    analysisBody = defaultAnalysis();

    await mockNavigationDependencies(page);
    await mockRuleSetApis(page);

    await page.route('**/rule-sets/*/srl**', async (route: Route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            srl: exportedSrl,
            ruleCount: 1,
            dataBlockCount: 0,
            tupleSeeds: exportedTupleSeeds,
            tuplesEnabled: exportedTuplesEnabled,
            warnings: [],
          }),
        });
        return;
      }
      lastImportContentType = route.request().headers()['content-type'];
      lastImportRequest = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: importStatus,
        contentType: 'application/json',
        body: JSON.stringify(importBody),
      });
    });

    // Playwright matches routes in REVERSE registration order (most recently
    // registered wins), so the specific /srl/* handlers must come LAST — the
    // generic '**/srl**' pattern also matches '/srl/preview' and '/srl/compile'.
    await page.route('**/rule-sets/srl/analyze', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(analysisBody),
      });
    });

    await page.route('**/rule-sets/srl/compile', async (route: Route) => {
      lastCompileRequest = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(compileBody),
      });
    });

    await page.route('**/rule-sets/*/srl/preview', async (route: Route) => {
      lastPreviewContentType = route.request().headers()['content-type'];
      lastPreviewRequest = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: previewStatus,
        contentType: 'application/json',
        body: JSON.stringify(previewBody),
      });
    });

    // NOTE: deliberately not waitForLoadState('networkidle') — against a live
    // dev server (HMR websocket / ongoing polling) the network never goes idle,
    // so that wait hangs until the test times out. Wait for a concrete element
    // instead.
    await openSection(page, 'rules');
  });

  test('opens on the document, with prefixes, DATA and rules in one editor', async ({ page }) => {
    exportedSrl = 'PREFIX : <http://example.org/>\n\nDATA { :a :p :b }\n\nRULE { ?s :q ?o } WHERE { ?s :p ?o }\n';

    await reloadForNewMocks(page);
    await openDefaultRuleSet(page);

    const editor = documentEditor(page);
    await expect(editor).toContainText('PREFIX : <http://example.org/>');
    await expect(editor).toContainText('DATA {');
    await expect(editor).toContainText('RULE {');
  });

  test('says what the document contains, and that it is valid SRL', async ({ page }) => {
    analysisBody = {
      ...defaultAnalysis(),
      ruleCount: 2,
      dataBlockCount: 1,
      stratification: {
        ...defaultAnalysis().stratification,
        strataCount: 2,
        negationCount: 1,
      },
    };

    await openDefaultRuleSet(page);

    await expect(page.locator('[data-testid="srl-validity-pill"]')).toHaveText(/valid SRL/i);
    await expect(page.locator('[data-testid="srl-counts"]')).toHaveText(/2 rules · 1 data block/i);
    await expect(page.locator('[data-testid="strata-chip"]')).toHaveText(/2 strata/i);
  });

  test('reports a document that does not parse without failing the request', async ({ page }) => {
    analysisBody = {
      ...defaultAnalysis(),
      valid: false,
      error: 'SRL syntax error: expected WHERE',
      ruleCount: 0,
      blocks: [],
    };

    await openDefaultRuleSet(page);

    await expect(page.locator('[data-testid="srl-validity-pill"]')).toHaveText(/invalid SRL/i);
  });

  test('shows the strata and the verdict in the Stratification tab, with no Rules tab', async ({ page }) => {
    analysisBody = {
      ...defaultAnalysis(),
      ruleCount: 2,
      dataBlockCount: 1,
      blocks: [
        { kind: 'data', index: 0, id: 'data-1', label: 'DATA block', name: null, startLine: 3, endLine: 5, stratum: null, monotonicity: null, runOnce: null, triples: 4 },
        { kind: 'rule', index: 0, id: 'rule-1', label: 'ex:friendOfFriend', name: null, startLine: 7, endLine: 11, stratum: 0, monotonicity: 'monotone', runOnce: false, triples: null },
        { kind: 'rule', index: 1, id: 'rule-2', label: 'ex:distantFriend', name: null, startLine: 13, endLine: 18, stratum: 1, monotonicity: 'negation', runOnce: false, triples: null },
      ],
      stratification: {
        strata: { 'rule-1': 0, 'rule-2': 1 },
        monotonicity: { 'rule-1': 'monotone', 'rule-2': 'negation' },
        runOnce: { 'rule-1': false, 'rule-2': false },
        edges: [{ from: 'rule-2', to: 'rule-1', label: 'negative', reasons: [] }],
        issues: [],
        strataCount: 2,
        negationCount: 1,
        runOnceCount: 0,
        stratified: true,
      },
    };

    await openDefaultRuleSet(page);

    /*
     * There is no Rules tab. Its outline duplicated the document already on
     * screen, and its strata counts are here — one graph, one place.
     */
    await expect(page.locator('[data-testid="rules-tab"]')).toHaveCount(0);

    await page.locator('[data-testid="stratification-tab"]').click();
    const pane = page.locator('[data-testid="rules-stratification"]');
    await expect(pane).toContainText('2 rules · 2 strata');
    // A document that stratifies says so by saying nothing: the verdict chip
    // is only for the failure.
    await expect(page.locator('[data-testid="stratification-verdict"]')).toHaveCount(0);
  });

  test('with one version and no edits there is nothing to diff', async ({ page }) => {
    await openDefaultRuleSet(page);

    const diff = page.locator('[data-testid="diff-query"]');
    await expect(diff).toBeDisabled();
    await expect(diff).toHaveAttribute('title', 'Nothing to diff against');
  });

  test('diffs the draft against the version it was made on', async ({ page }) => {
    await openDefaultRuleSet(page);
    await typeDocument(page, 'PREFIX : <http://example.org/>\nRULE { ?s :edited ?o } WHERE { ?s :p ?o }');
    await openPreview(page);

    const dialog = page.locator('[data-testid="srl-diff-dialog"]');
    await expect(dialog.getByText('v1 (current) → Draft')).toBeVisible();
    await expect(dialog.locator('.cm-mergeView')).toBeVisible();
    await expect(dialog.locator('.cm-mergeView')).toContainText(':edited');
    // A save that changes nothing structural has nothing to add under the diff.
    await expect(dialog.locator('[data-testid="srl-save-impact"]')).toHaveCount(0);
    // The draft is posted exactly as authored — one editor, one string.
    expect(String(lastPreviewRequest?.srl)).toContain(':edited');
    // Regression guard: without an explicit JSON content-type the browser sends
    // text/plain, Fastify never parses the body, and the API rejects the request
    // with a root-level type error ('"Field" must be of type object').
    expect(lastPreviewContentType).toContain('application/json');
  });

  test('previews created rules and distinguishes orphaned from shared detaches', async ({ page }) => {
    previewBody = {
      ...emptyPreview(),
      created: [{ label: 'rule-1-ancestorOf', named: false, text: 'RULE { } WHERE { }' }],
      detached: [
        { ruleVersionId: 'urn:rv:orphan', ruleId: 'urn:rule:1', otherRuleSets: 0, orphaned: true },
        { ruleVersionId: 'urn:rv:shared', ruleId: 'urn:rule:2', otherRuleSets: 2, orphaned: false },
      ],
    };

    await openDefaultRuleSet(page);
    await typeDocument(page, 'PREFIX : <http://example.org/>\nRULE { ?s :edited ?o } WHERE { ?s :p ?o }');
    await openPreview(page);

    await expect(page.getByText('rule-1-ancestorOf')).toBeVisible();
    await expect(page.getByText(/auto-named/i)).toBeVisible();
    await expect(page.getByText(/no longer used anywhere/i)).toBeVisible();
    await expect(page.getByText(/still used by 2 other rule sets/i)).toBeVisible();
    // Detach must never read as deletion — said in the row, not only in the
    // dialog's own preamble (which also carries the phrase).
    await expect(page.getByText(/no longer used anywhere\. Nothing is deleted/i)).toBeVisible();
  });

  test('shows the server error when a preview is rejected', async ({ page }) => {
    previewStatus = 400;
    previewBody = { error: 'The SRL document contains no rules' };

    await openDefaultRuleSet(page);
    await typeDocument(page, 'PREFIX : <http://example.org/>\nRULE { ?s :edited ?o } WHERE { ?s :p ?o }');
    await openPreview(page);

    await expect(page.getByText(/contains no rules/i)).toBeVisible();
  });

  test('saves a multi-rule document and posts the whole thing', async ({ page }) => {
    exportedSrl = 'PREFIX : <http://example.org/>\n';
    importBody = {
      ruleSetVersionId: 'urn:sqlib:rule-set-version:srl-test-v2',
      version: 2,
      created: ['urn:rv:a', 'urn:rv:b'],
      updated: [],
      detached: [],
      ruleCount: 2,
      dataCreated: [],
      dataDetached: [],
      dataBlockCount: 0,
      tuplesEnabled: false,
    };

    await openDefaultRuleSet(page);

    const multiRule = [
      'PREFIX : <http://example.org/>',
      'RULE { ?x :ancestorOf ?y } WHERE { ?x :parentOf ?y }',
      'RULE :adults { ?p :isAdult true } WHERE { ?p :age ?a FILTER(?a >= 18) }',
    ].join('\n\n');
    await typeDocument(page, multiRule);
    await save(page);

    await expect(page.getByText(/Saved v2/i)).toBeVisible();
    const posted = String(lastImportRequest?.srl ?? '');
    // A ruleset is one document: several RULE ... WHERE blocks in one string.
    expect(posted).toContain(':ancestorOf');
    expect(posted).toContain('RULE :adults');
    expect(posted).toContain('PREFIX : <http://example.org/>');
    expect(lastImportContentType).toContain('application/json');
  });

  test('will not save a document that has not been edited', async ({ page }) => {
    await openDefaultRuleSet(page);

    // Nothing has changed since the version was loaded, so saving would
    // mint a version identical to the last one.
    await expect(page.locator('[data-testid="save"]')).toBeDisabled();
  });

  test('reports data block changes in the preview', async ({ page }) => {
    previewBody = {
      ...emptyPreview(),
      data: {
        created: [{ label: 'data-1', text: 'DATA { :a :p :b }' }],
        unchangedCount: 0,
        detached: [{ dataBlockVersionId: 'urn:dbv:old', otherRuleSets: 0, orphaned: true }],
      },
    };

    await openDefaultRuleSet(page);
    await typeDocument(page, 'PREFIX : <http://example.org/>\nRULE { ?s :edited ?o } WHERE { ?s :p ?o }');
    await openPreview(page);

    await expect(page.getByText('data-1')).toBeVisible();
    await expect(page.getByText('urn:dbv:old')).toBeVisible();
  });

  /*
   * Named tuples are an *input*, not definition, so they are typed in the
   * Inputs tab and never above the document. The editor column holds SRL and
   * nothing else, whether or not the extension is on.
   */
  test('takes named tuples from the Inputs tab, never from the editor column', async ({ page }) => {
    await openDefaultRuleSet(page);

    await expect(page.locator('[data-testid="initial-tuples"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="run-bar"]')).toBeVisible();

    await page.locator('[data-testid="details-tab"]').click();
    await page.locator('[data-testid="tuples-toggle"]').check();
    await expect(page.locator('[data-testid="initial-tuples"]')).toHaveCount(0);

    await page.locator('[data-testid="inputs-tab"]').click();
    const seeds = page.locator('[data-testid="inputs-tuples"] .cm-content');
    await seeds.click();
    await page.keyboard.type('TUPLE(:reach, :a, :b)');
    await typeDocument(page, 'PREFIX : <http://example.org/>\n\nRULE { ?x :ok true } WHERE { ?x :p ?o }');
    await save(page);

    await expect(page.getByText(/Saved v2/i)).toBeVisible();
    expect(lastImportRequest?.tuples).toBe(true);
    expect(lastImportRequest?.tupleSeeds).toBe('TUPLE(:reach, :a, :b)');
  });

  test('loads a ruleset that already opted in, seed rows and all', async ({ page }) => {
    exportedTuplesEnabled = true;
    exportedTupleSeeds = 'TUPLE(:reach, :a, :b)';

    await reloadForNewMocks(page);
    await openDefaultRuleSet(page);

    // Inputs is the default tab, so the rows are already on screen.
    await expect(page.locator('[data-testid="inputs-tuples"] .cm-content'))
      .toContainText('TUPLE(:reach, :a, :b)');
    await page.locator('[data-testid="details-tab"]').click();
    await expect(page.locator('[data-testid="tuples-toggle"]')).toBeChecked();
  });

  test('refuses to turn the extension off while tuple content is present', async ({ page }) => {
    exportedTuplesEnabled = true;
    exportedSrl = 'PREFIX : <http://example.org/>\n\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x) }\n';

    await reloadForNewMocks(page);
    await openDefaultRuleSet(page);
    await page.locator('[data-testid="details-tab"]').click();
    // Not uncheck() — that asserts the box flips, and refusing to flip is the
    // behaviour under test. Click it and check what the screen did about it.
    await page.locator('[data-testid="tuples-toggle"]').click();

    await expect(page.getByText(/Remove the tuple rules/i)).toBeVisible();
    // Blocked, and nothing authored was thrown away to enforce it.
    await expect(page.locator('[data-testid="tuples-toggle"]')).toBeChecked();
    await expect(documentEditor(page)).toContainText('TUPLE(:rel, ?x)');
  });

  test('shows the equivalent SPARQL for a chosen block', async ({ page }) => {
    compileBody = {
      rules: [
        {
          index: 0,
          name: null,
          label: 'rule-1-q',
          srl: 'RULE { } WHERE { }',
          sparql: 'INSERT { ?s :q ?o } WHERE { ?s :p ?o }',
          producesTuples: false,
          tupleReads: 0,
          caveats: [],
        },
      ],
      dataBlocks: [],
      flavour: 'insert',
    };

    await openDefaultRuleSet(page);
    await page.locator('[data-testid="sparql-tab"]').click();

    await expect(page.getByText('rule-1-q')).toBeVisible();
    await expect(page.locator('[data-testid="sparql-pane"] .cm-content')).toContainText('INSERT { ?s :q ?o }');
    // The standing caveat travels with the tab: one pass is not a fixpoint.
    await expect(page.getByText(/one pass, run in stratum order/i)).toBeVisible();
    expect(String(lastCompileRequest?.srl)).toContain('RULE {');
  });

  /*
   * Issue #158. The toggle asks the compiler for the other reading rather than
   * rewriting the string on screen, so the assertion that matters is that the
   * request carries the flavour — the CONSTRUCT text is the route's answer.
   */
  test('asks for the CONSTRUCT reading when the flavour is switched', async ({ page }) => {
    const program = (sparql: string, flavour: string) => ({
      rules: [{
        index: 0,
        name: null,
        label: 'rule-1-q',
        srl: 'RULE { } WHERE { }',
        sparql,
        producesTuples: false,
        tupleReads: 0,
        caveats: [],
      }],
      dataBlocks: [],
      flavour,
    });

    compileBody = program('INSERT { ?s :q ?o } WHERE { ?s :p ?o }', 'insert');

    await openDefaultRuleSet(page);
    await page.locator('[data-testid="sparql-tab"]').click();
    await expect(page.locator('[data-testid="sparql-pane"] .cm-content')).toContainText('INSERT {');

    compileBody = program('CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }', 'construct');
    await page.locator('[data-testid="sparql-flavour-construct"]').click();

    await expect(page.locator('[data-testid="sparql-pane"] .cm-content')).toContainText('CONSTRUCT {');
    expect(lastCompileRequest?.flavour).toBe('construct');
    // And back: the INSERT reading is the default, so it carries no flavour.
    compileBody = program('INSERT { ?s :q ?o } WHERE { ?s :p ?o }', 'insert');
    await page.locator('[data-testid="sparql-flavour-insert"]').click();
    await expect(page.locator('[data-testid="sparql-pane"] .cm-content')).toContainText('INSERT {');
    expect(lastCompileRequest?.flavour).toBeUndefined();
  });

  /*
   * The grammar offers a rewrite for a SPARQL spelling it recognises, and
   * CodeMirror draws that offer inline after the message — at the far end of a
   * sentence whose length varies with the diagnostic. Stacked under it, the
   * button is in the same place in every tooltip, and the pair reads in the
   * order it is needed: the complaint, then the remedy.
   */
  test('a conversion offer sits on its own line, under the message', async ({ page }) => {
    await openDefaultRuleSet(page);
    await typeDocument(page, 'CONSTRUCT {?s ?p ?o} WHERE {?s ?p ?o}');

    await page.locator('.cm-lintRange-error').first().hover();
    const diagnostic = page.locator('.cm-tooltip .cm-diagnostic').first();
    await expect(diagnostic).toBeVisible();
    await expect(diagnostic.locator('.cm-diagnosticAction')).toBeVisible();

    // Under, not beside: the action's box clears the message's.
    const action = (await diagnostic.locator('.cm-diagnosticAction').boundingBox())!;
    const message = (await diagnostic.locator('.cm-diagnosticText').boundingBox())!;
    expect(action.y).toBeGreaterThanOrEqual(message.y + message.height - 1);
  });

  /*
   * A tooltip inside `.cm-editor` inherits the editor's own type — 13px
   * monospace, set for code — so a sentence of prose rendered a step larger
   * than every other sentence in the app. Asserted against the tokens rather
   * than against pixel values, so the scale can move without this moving with
   * it.
   */
  test('a diagnostic is set in the app\'s type, not the editor\'s', async ({ page }) => {
    await openDefaultRuleSet(page);
    await typeDocument(page, 'CONSTRUCT {?s ?p ?o} WHERE {?s ?p ?o}');

    await page.locator('.cm-lintRange-error').first().hover();
    const diagnostic = page.locator('.cm-tooltip .cm-diagnostic').first();
    await expect(diagnostic).toBeVisible();

    const type = await diagnostic.evaluate((element) => {
      const tokens = getComputedStyle(document.documentElement);
      const message = element.querySelector('.cm-diagnosticText') as HTMLElement;
      const action = element.querySelector('.cm-diagnosticAction') as HTMLElement;
      const px = (token: string) => {
        const probe = document.createElement('div');
        probe.style.fontSize = tokens.getPropertyValue(token);
        document.body.append(probe);
        const value = getComputedStyle(probe).fontSize;
        probe.remove();
        return value;
      };
      return {
        message: getComputedStyle(message).fontSize,
        action: getComputedStyle(action).fontSize,
        body: px('--text-body'),
        sans: getComputedStyle(message).fontFamily,
      };
    });

    expect(type.message).toBe(type.body);
    // The button is set in the message's size, not a step under it.
    expect(type.action).toBe(type.body);
    expect(type.sans).toContain('Inter');
  });

  test('reports a save failure without claiming success', async ({ page }) => {
    importStatus = 400;
    importBody = { error: 'Rule set not found' };

    await openDefaultRuleSet(page);
    await typeDocument(page, 'PREFIX : <http://example.org/>\n\nRULE { ?s :r ?o } WHERE { ?s :p ?o }');
    await save(page);

    await expect(page.getByText(/Rule set not found/i)).toBeVisible();
    // Scoped to the toaster: success here means a success *toast*. Page-wide,
    // the phrase also matches ordinary copy — the Code tab's draft note says a
    // snippet runs the saved version — and that is not a claim of success.
    await expect(page.locator('[data-sonner-toaster]').getByText(/Saved v/i)).toHaveCount(0);
  });

  /*
   * The document editor, not the initial-tuples strip above it — both are
   * CodeMirror instances inside the work area.
   */
  const documentEditor = (page: Page) =>
    page.locator('.ruleset-work-area .editor-section .cm-content').first();

  /** Replace the document and wait past the 500ms draft-autosave debounce. */
  async function typeDocument(page: Page, text: string) {
    const editor = documentEditor(page);
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(text);
    await expect(editor).toContainText(text.slice(0, 20));
    await page.waitForTimeout(700);
  }

  /** Save. The bar asks for nothing — the version note is written in Details. */
  async function save(page: Page) {
    await page.locator('[data-testid="save"]').click();
  }

  /**
   * `beforeEach` already opened the Rules section, which opens the rule set
   * and fetches its document straight away. A test that changes what the
   * export returns has to load the page again for the change to be seen.
   */
  async function reloadForNewMocks(page: Page) {
    await page.reload({ waitUntil: 'domcontentloaded' });
  }

  /**
   * The document header's Diff: the draft against the version it was made on,
   * with what saving it would create or detach underneath.
   */
  async function openPreview(page: Page) {
    await page.locator('[data-testid="diff-query"]').click();
  }

  /**
   * The Rules sidebar, which replaced the artifact tree: one flat list of rule
   * sets, no library row to expand and no category under it.
   *
   * All waits use auto-retrying `expect`s rather than `count()` checks: the
   * sidebar renders before the rule sets have been fetched, so a bare count
   * races and reads 0.
   */
  async function openDefaultRuleSet(page: Page) {
    const row = page.locator(`[data-entity-id="${defaultRuleSet.id}"]`);
    await expect(row).toBeVisible();
    await row.click();

    await expect(page.locator('.ruleset-work-area')).toBeVisible();
    // The document arrives from the export route; typing before it lands would
    // be overwritten when it does.
    await expect(documentEditor(page)).toContainText('PREFIX');
  }
});

async function mockNavigationDependencies(page: Page) {
  await page.route('**/libraries', fulfillWithJson([defaultLibrary]));
  await page.route('**/queries', fulfillWithJson([]));
  await page.route('**/query-groups', fulfillWithJson([]));
  await page.route('**/rules', fulfillWithJson([]));
  await page.route('**/data-blocks', fulfillWithJson([]));
  await page.route('**/backends', fulfillWithJson([]));
}

async function mockRuleSetApis(page: Page) {
  await page.route('**/rule-sets', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([defaultRuleSet]),
      });
      return;
    }
    await route.fulfill({ status: 405 });
  });

  await page.route('**/rule-sets/*/versions', fulfillWithJson([defaultRuleSetVersion]));

  await page.route('**/rule-sets/*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: '"test-etag"' },
      body: JSON.stringify(defaultRuleSet),
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
