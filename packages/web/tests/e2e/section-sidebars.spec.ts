import { test, expect, type Page } from '@playwright/test';
import { mockEntityApi, RULE, RULE_SET, DATA_BLOCK, BENCHMARK_EXPERIMENT } from './fixtures/entities';

/**
 * The flat sidebar in the three sections that used to be stuck on the tree.
 *
 * Each was blocked for a structural reason, not for scheduling, and each claim
 * below is one of those blockers being gone:
 *
 * - **Rules** lists rule sets and nothing else. It once listed rules and data
 *   blocks beside them, because each had a work area of its own and the flat
 *   list was the only way to reach it. Those work areas are gone — a rule set
 *   is the smallest editable unit — so a rule is reached by opening the set
 *   that holds it, and a second row for it would be a second door to nothing.
 * - **ETL** saves into an EtlJob like everything else; its Saved cluster
 *   lists them.
 * - **Bench** could not be told what to open. It takes the selection now, and
 *   an experiment is not library-scoped, so the library strip must not hide it.
 */

const DRAFTS_KEY = 'sparql-query-lib-callable-drafts';
const MIGRATION_KEY = 'sparql-query-lib-scratch-migrated';

function scratchRecord(section: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `urn:ui-temp:seeded-${section}`,
    libraryId: 'unassigned',
    type: 'query',
    kind: 'scratch',
    section,
    name: `Seeded ${section}`,
    description: null,
    queryString: null,
    body: null,
    resultKind: 'BINDINGS',
    inputTuples: [],
    limitParameters: [],
    offsetParameters: [],
    outputs: [],
    basedOn: null,
    edits: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

async function seedScratch(page: Page, records: Array<Record<string, unknown>>) {
  await page.addInitScript(
    ([key, migrated, payload]) => {
      localStorage.setItem(key as string, payload as string);
      // Suppress the playground migration; it would add rows this spec did not
      // ask for and the counts would drift for a reason unrelated to the test.
      localStorage.setItem(migrated as string, '2026-01-01T00:00:00Z');
    },
    [DRAFTS_KEY, MIGRATION_KEY, JSON.stringify(records)],
  );
}

async function openSection(page: Page, section: string) {
  await page.goto(`/?section=${section}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="entity-list-sidebar"]');
}

test.describe('Rules sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page);
    await seedScratch(page, []);
  });

  test('replaces the tree for this section', async ({ page }) => {
    await openSection(page, 'rules');
    await expect(page.locator('[data-testid="entity-list-sidebar"]')).toBeVisible();
    await expect(page.locator('.nav-sidebar')).toHaveCount(0);
  });

  test('lists one kind, so it needs no subheadings', async ({ page }) => {
    await openSection(page, 'rules');
    await expect(page.locator(`[data-entity-id="${RULE_SET.id}"]`)).toBeVisible();
    // Subheadings exist to tell two rows apart that open different screens.
    // With rule sets alone there is nothing to tell apart.
    await expect(page.locator('.group-name')).toHaveCount(0);
  });

  /*
   * The inverse of what this used to assert. A rule listed beside its rule set
   * would open the standalone rule editor, and that editor is gone — so the
   * row must be gone too, rather than pointing at a screen that no longer
   * exists.
   */
  test('does not list rules or data blocks on their own', async ({ page }) => {
    await openSection(page, 'rules');
    await expect(page.locator(`[data-entity-id="${RULE_SET.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-entity-id="${RULE.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-entity-id="${DATA_BLOCK.id}"]`)).toHaveCount(0);
  });

  test('opens a rule set in the rules work area', async ({ page }) => {
    await openSection(page, 'rules');

    await page.locator(`[data-entity-id="${RULE_SET.id}"]`).click();
    await expect(page).toHaveURL(
      new RegExp(`ruleSet=${encodeURIComponent(RULE_SET.id)}|ruleSet=${RULE_SET.id}`),
    );
    await expect(page.locator('.ruleset-work-area')).toBeVisible();
  });

  test('+ New opens an unsaved rules workspace, not a dialog', async ({ page }) => {
    await openSection(page, 'rules');
    await page.locator('[data-testid="new-scratch"]').click();

    await expect(page).toHaveURL(/scratch=/);
    await expect(page.locator('[data-testid="scratch-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="scratch-chip"]')).toBeVisible();
    // The same rules screen a saved rule set opens, with nothing saved yet.
    await expect(page.locator('.ruleset-work-area .editor-section .cm-content')).toBeVisible();
  });

  test('a seeded rules workspace loads its own bodies', async ({ page }) => {
    await seedScratch(page, [
      scratchRecord('rule', {
        name: 'Transitive closure draft',
        body: { dataBlocks: ['DATA { <urn:a> <urn:b> <urn:c> }'], rules: ['RULE { ?s ?p ?o } WHERE { ?s ?p ?o }'] },
      }),
    ]);
    await openSection(page, 'rules');

    await page.locator('[data-testid="scratch-row"]').click();
    await expect(page.locator('[data-testid="save-bar"] .query-title')).toHaveText('Transitive closure draft');
    /*
     * A draft opens the rules work area, not a separate playground, and its
     * body is one SRL document — this record predates that, so it also covers
     * the migration of a stored {dataBlocks, rules} pair into one.
     */
    const document = page.locator('.ruleset-work-area .editor-section .cm-content');
    await expect(document).toContainText('DATA { <urn:a>');
    await expect(document).toContainText('RULE { ?s ?p ?o }');
  });

  // The tab strip's whole job, done by the list: two unsaved workspaces, and
  // switching between them keeps both.
  test('holds several unsaved workspaces at once', async ({ page }) => {
    await openSection(page, 'rules');
    await page.locator('[data-testid="new-scratch"]').click();
    await expect(page.locator('[data-testid="scratch-row"]')).toHaveCount(1);
    await page.locator('[data-testid="new-scratch"]').click();
    await expect(page.locator('[data-testid="scratch-row"]')).toHaveCount(2);
  });
});

test.describe('ETL sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page);
    await seedScratch(page, []);
  });

  /*
   * An EtlJob is a real server entity now, so a pipeline saves into one and
   * the Saved cluster is a cluster that can fill.
   */
  test('lists both clusters', async ({ page }) => {
    await openSection(page, 'etl');
    await expect(page.locator('.section-name')).toHaveText('ETL');
    await expect(page.locator('.cluster-name', { hasText: 'Scratch' })).toBeVisible();
  });

  test('lands on a pipeline rather than an empty screen', async ({ page }) => {
    await openSection(page, 'etl');
    await expect(page).toHaveURL(/scratch=/);
    await expect(page.locator('[data-testid="scratch-row"]')).toHaveCount(1);
  });

  /*
   * This screen had no persistence at all before: a reload lost the SQL, the
   * mappings and the template together.
   */
  test('keeps a pipeline across a reload', async ({ page }) => {
    await seedScratch(page, [
      scratchRecord('etl', {
        name: 'Emissions by region',
        body: { sql: "SELECT * FROM read_csv('emissions.csv')", sparqlTemplate: '', outputFormat: 'text/turtle' },
      }),
    ]);
    await openSection(page, 'etl');
    await page.locator('[data-testid="scratch-row"]').click();
    await expect(page.locator('[data-testid="save-bar"] .query-title')).toHaveText('Emissions by region');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="save-bar"] .query-title')).toHaveText('Emissions by region');
  });

  test('an old ?playground=etl link lands in the section', async ({ page }) => {
    await page.goto('/?playground=etl', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="entity-list-sidebar"]');
    await expect(page.locator('.section-name')).toHaveText('ETL');
  });
});

test.describe('Bench sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page);
    await seedScratch(page, []);
  });

  /*
   * A BenchmarkExperiment has no `isPartOf`. If the list were filtered by the
   * library strip like the other four, every experiment would vanish from it.
   */
  test('lists experiments even though they are not library-scoped', async ({ page }) => {
    await openSection(page, 'benchmarks');
    await expect(page.locator(`[data-entity-id="${BENCHMARK_EXPERIMENT.id}"]`)).toBeVisible();
  });

  test('opens the experiment the sidebar selected', async ({ page }) => {
    await openSection(page, 'benchmarks');
    await page.locator(`[data-entity-id="${BENCHMARK_EXPERIMENT.id}"]`).click();
    await expect(page).toHaveURL(/benchmark=urn/);
  });

  test('+ New starts an unsaved benchmark', async ({ page }) => {
    await openSection(page, 'benchmarks');
    await page.locator('[data-testid="new-scratch"]').click();

    await expect(page).toHaveURL(/scratch=/);
    await expect(page.locator('[data-testid="scratch-chip"]')).toBeVisible();
    // Nothing to run yet: no name, no target. The button is the shared save
    // bar's now, as on every other section.
    await expect(page.locator('[data-testid="save"]')).toBeDisabled();
  });
});

test.describe('scratch across sections', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityApi(page);
  });

  /*
   * One store, one URL parameter, five sections. A `?scratch=` link carries no
   * section of its own — the record says which it belongs to — so the wrong
   * work area opening is the failure this guards.
   */
  test('a scratch link opens the section its record belongs to', async ({ page }) => {
    await seedScratch(page, [scratchRecord('etl', { name: 'A pipeline' }), scratchRecord('rule', { name: 'A rule set' })]);

    await page.goto(`/?section=etl&scratch=${encodeURIComponent('urn:ui-temp:seeded-rule')}`, {
      waitUntil: 'domcontentloaded',
    });
    // The record is a rules workspace, so that is what renders, whatever the
    // section parameter beside it says.
    await expect(page.locator('[data-testid="save-bar"] .query-title')).toHaveText('A rule set');
  });

  test('each section counts only its own unsaved items', async ({ page }) => {
    await seedScratch(page, [
      scratchRecord('etl', { name: 'A pipeline' }),
      scratchRecord('rule', { name: 'A rule set' }),
      scratchRecord('bench', { name: 'A benchmark' }),
    ]);

    await openSection(page, 'etl');
    await expect(page.locator('[data-testid="scratch-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="scratch-row"]')).toHaveText(/A pipeline/);
  });
});
