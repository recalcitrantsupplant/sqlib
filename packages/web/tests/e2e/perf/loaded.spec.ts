/**
 * The realistic case: open the editor overlay while a large result set is
 * rendered behind it.
 *
 *   PERF_ROWS=1000 npx playwright test tests/e2e/perf/loaded
 *
 * An empty playground opens the overlay in ~35ms. If cost scales with the
 * number of rows BEHIND the overlay, the expense is compositing the backdrop,
 * not mounting the editor.
 */
import { test, expect } from '@playwright/test';
import { mockSidebarCollections } from '../fixtures/collections';
import { measureOpen, summarise, type Sample } from './measure';

const BASE = process.env.PERF_BASE ?? 'http://localhost:3002';
const CPU_THROTTLE = Number(process.env.PERF_CPU ?? 4);
const REPEATS = Number(process.env.PERF_REPEATS ?? 7);
const ROW_COUNTS = (process.env.PERF_ROWS ?? '0,100,1000,5000')
  .split(',')
  .map((n) => Number(n.trim()));

function sparqlResults(rows: number) {
  return {
    head: { vars: ['subject', 'predicate', 'object'] },
    results: {
      bindings: Array.from({ length: rows }, (_, i) => ({
        subject: { type: 'uri', value: `http://example.org/subject/${i}` },
        predicate: { type: 'uri', value: 'http://example.org/predicate/name' },
        object: { type: 'literal', value: `Value number ${i} with some padding text` },
      })),
    },
  };
}

test('@perf overlay open cost vs rows rendered behind it', async ({ page }) => {
  test.setTimeout(600_000);

  const rowsRef = { count: 0 };

  await mockSidebarCollections(page, {
    backends: [
      {
        id: 'urn:sqlib:backend:perf',
        name: 'Perf Backend',
        description: 'mock',
        backendType: 'http',
        endpoint: 'http://localhost:7878/sparql',
        authEnvKey: null,
        oxigraphConfig: null,
        dateCreated: '2024-01-01T00:00:00Z',
        dateModified: '2024-01-01T00:00:00Z',
      },
    ],
  });

  await page.route('**/sparql', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/sparql-results+json',
      body: JSON.stringify(sparqlResults(rowsRef.count)),
    });
  });

  const cdp = await page.context().newCDPSession(page);
  const rows: string[] = [];

  for (const rowCount of ROW_COUNTS) {
    rowsRef.count = rowCount;

    // Throttling off during setup so page load and execution stay quick; it is
    // only the measured click that needs to run at emulated-slow speed.
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.goto(BASE, { waitUntil: 'networkidle' });

    await page.locator('.cm-content').first().waitFor();
    await page
      .locator('.cm-content')
      .first()
      .fill('SELECT * WHERE { ?subject ?predicate ?object } LIMIT 10000');

    await page.locator('button:has-text("Execute")').first().click();
    // Results panel must actually be painted before we measure over it.
    await expect(page.locator('.focus-overlay')).toHaveCount(0);
    await page.waitForTimeout(2000);

    const renderedCells = await page.locator('td').count();

    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    const samples: Sample[] = [];
    for (let i = 0; i < REPEATS; i++) {
      samples.push(
        await measureOpen(page, {
          trigger: '[data-testid="sparql-editor-expand"]',
          appears: '.expand-region.expanded .cm-editor',
        })
      );
      await page.locator('[data-testid="query-editor-expand-close"]').click();
      await page.locator('.expand-region.expanded').waitFor({ state: 'detached' });
    }

    const warm = summarise(samples.slice(1));
    rows.push(
      `rows=${String(rowCount).padStart(5)}  cells=${String(renderedCells).padStart(6)}  ` +
        `visible=${warm.timeToVisible.toFixed(0).padStart(5)}ms  ` +
        `processing=${warm.processing.toFixed(0).padStart(4)}ms  ` +
        `blocking=${warm.blockingTime.toFixed(0).padStart(5)}ms  ` +
        `each=[${samples.map((s) => s.timeToVisible.toFixed(0)).join(', ')}]`
    );
  }

  console.log(`\n=== overlay open, cpu=${CPU_THROTTLE}x, warm median ===\n${rows.join('\n')}\n`);
});

const QUERY_LINES = (process.env.PERF_QUERY_LINES ?? '1,50,200,1000')
  .split(',')
  .map((n) => Number(n.trim()));

/** A syntactically plausible query of roughly `lines` lines. */
function bigQuery(lines: number) {
  const body = Array.from(
    { length: Math.max(0, lines - 2) },
    (_, i) => `  ?s${i} <http://example.org/predicate/p${i}> ?o${i} .`
  ).join('\n');
  return `SELECT * WHERE {\n${body}\n}`;
}

test('@perf overlay open cost vs query document size', async ({ page }) => {
  test.setTimeout(600_000);
  await mockSidebarCollections(page);

  const cdp = await page.context().newCDPSession(page);
  const rows: string[] = [];

  for (const lines of QUERY_LINES) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const editor = page.locator('.cm-content').first();
    await editor.waitFor();
    await editor.fill(bigQuery(lines));
    // Let validation/parse settle so we measure the overlay, not the debounce.
    await page.waitForTimeout(2500);

    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    const samples: Sample[] = [];
    for (let i = 0; i < REPEATS; i++) {
      samples.push(
        await measureOpen(page, {
          trigger: '[data-testid="sparql-editor-expand"]',
          appears: '.expand-region.expanded .cm-editor',
        })
      );
      await page.locator('[data-testid="query-editor-expand-close"]').click();
      await page.locator('.expand-region.expanded').waitFor({ state: 'detached' });
    }

    const warm = summarise(samples.slice(1));
    rows.push(
      `lines=${String(lines).padStart(5)}  ` +
        `visible=${warm.timeToVisible.toFixed(0).padStart(5)}ms  ` +
        `processing=${warm.processing.toFixed(0).padStart(5)}ms  ` +
        `blocking=${warm.blockingTime.toFixed(0).padStart(5)}ms  ` +
        `longest=${warm.longestTask.toFixed(0).padStart(5)}ms  ` +
        `each=[${samples.map((s) => s.timeToVisible.toFixed(0)).join(', ')}]`
    );
  }

  console.log(`\n=== overlay open vs query size, cpu=${CPU_THROTTLE}x ===\n${rows.join('\n')}\n`);
});
