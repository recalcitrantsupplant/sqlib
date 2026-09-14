/**
 * UAT for RDF Patch as an update query's output (#290), against the seeded
 * demo library.
 *
 * The claim under test is not "the UI renders something". It is that pressing
 * Run on an update shows the diff that update would actually make, and that
 * asking for the diff does not make it. Both of those are facts about a real
 * store, so this lane talks to one: `just run-local-patch-demo` puts the
 * catalogue behind a writable in-memory backend, and every expected patch below
 * is written out in full because the dataset is small enough to check by hand.
 *
 * The specs run in order and share that store. Only the last one writes to it,
 * and it puts it back.
 */

import { expect, test, type Page } from '@playwright/test';
import { UAT_API_URL } from '../../playwright.uat.config';

const EX = 'https://example.com/catalogue#';
const BACKEND_ID = 'urn:sqlib:backend:rdf-patch-demo';

/** How long the SPA needs to boot, resolve the rail and load a query. */
const SETTLE_MS = 1500;

test.describe.configure({ mode: 'serial' });

/**
 * Open a demo query and press Run, returning the patch document as text.
 *
 * The rail starts with everything collapsed, so the library and its Queries
 * category are expanded on the way. Both are idempotent to click here only
 * because each spec starts from a fresh page.
 */
async function runDemoQuery(page: Page, queryName: string): Promise<string> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByText('RDF Patch demo', { exact: true }).first().click();
  await page.getByText('Queries', { exact: true }).first().click();
  await page.getByText(queryName).first().click();

  // The format picker settling on RDF Patch is itself the assertion that an
  // update has an output at all: before #290 nothing was valid for one.
  await expect(page.getByRole('button', { name: /RDF Patch/ })).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText('text/rdf-patch').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(SETTLE_MS);

  return page.locator('body').innerText();
}

/** The `A`/`D` lines of a rendered patch, as `A <s> <p> "o"` strings. */
function patchLines(rendered: string): string[] {
  return rendered
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[AD] </.test(line));
}

const addition = (s: string, p: string, o: string) => `A <${EX}${s}> <${EX}${p}> ${o} .`;
const deletion = (s: string, p: string, o: string) => `D <${EX}${s}> <${EX}${p}> ${o} .`;

test('the demo library seeds nine update queries, in order', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByText('RDF Patch demo', { exact: true }).first().click();
  await page.getByText('Queries', { exact: true }).first().click();

  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    await expect(page.getByText(new RegExp(`^${n}\\. |^${n}\\.`)).first()).toBeVisible();
  }
  // The backend arrives with them, and its name says the two things a reader
  // needs to know before pressing Apply.
  await expect(page.getByText('Patch demo catalogue (in memory, writable)').first()).toBeVisible();
});

test('a ground INSERT DATA previews as additions and nothing else', async ({ page }) => {
  const lines = patchLines(await runDemoQuery(page, '1. INSERT DATA'));

  expect(lines.filter(line => line.startsWith('D'))).toEqual([]);
  expect(new Set(lines)).toEqual(new Set([
    addition('doc-5', 'title', '"Travel policy"'),
    addition('doc-5', 'status', '"draft"'),
    `A <${EX}doc-5> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${EX}Document> .`,
  ]));
});

test('inserting what the store already holds is reported as the change, not the request', async ({ page }) => {
  const lines = patchLines(await runDemoQuery(page, '2. INSERT DATA'));

  // Three triples asked for; doc-3 is already a Document and already live, so
  // one is left. This is the net-effect arithmetic, visible.
  expect(lines).toEqual([addition('doc-3', 'owner', '"platform-team"')]);
});

test('deleting an absent triple contributes nothing to the diff', async ({ page }) => {
  const lines = patchLines(await runDemoQuery(page, '3. DELETE DATA'));

  expect(lines).toEqual([deletion('doc-4', 'reviewNote', '"Superseded by the finance handbook"')]);
});

test('DELETE … INSERT … WHERE names the concrete rows, not the pattern', async ({ page }) => {
  const lines = patchLines(await runDemoQuery(page, '4. DELETE … INSERT … WHERE'));

  expect(new Set(lines)).toEqual(new Set([
    deletion('doc-1', 'status', '"draft"'),
    deletion('doc-2', 'status', '"draft"'),
    addition('doc-1', 'status', '"live"'),
    addition('doc-2', 'status', '"live"'),
  ]));
});

test('DELETE WHERE lists every triple the pattern matches', async ({ page }) => {
  const lines = patchLines(await runDemoQuery(page, '5. DELETE WHERE'));

  expect(new Set(lines)).toEqual(new Set([
    deletion('doc-1', 'reviewNote', '"Needs a screenshot"'),
    deletion('doc-2', 'reviewNote', '"Legal have signed off"'),
    deletion('doc-4', 'reviewNote', '"Superseded by the finance handbook"'),
  ]));
});

test('an update that changes nothing previews as an empty patch', async ({ page }) => {
  const rendered = await runDemoQuery(page, '6. The update that changes nothing');

  expect(patchLines(rendered)).toEqual([]);
  // Empty, but a patch: the transaction markers are still there, so "no change"
  // is a result rather than a failure to produce one.
  expect(rendered).toContain('TX .');
  expect(rendered).toContain('TC .');
});

test('a template GRAPH block stamps its graph on the quad', async ({ page }) => {
  const lines = patchLines(await runDemoQuery(page, '7. INSERT … WHERE into a named graph'));

  expect(lines).toEqual([
    `A <${EX}doc-4> <${EX}archivedOn> "2026-09-03" <${EX}archive> .`,
  ]);
});

test('a two-operation program derives the second half against what the first left', async ({ page }) => {
  const lines = patchLines(await runDemoQuery(page, '8. Two operations'));

  // doc-6 is inserted as a draft and promoted by the operation after it, so the
  // patch adds it *live* and never mentions the draft it briefly was. Deriving
  // both operations against the store as it stands would have missed it
  // entirely.
  expect(lines).toContain(addition('doc-6', 'status', '"live"'));
  expect(lines).not.toContain(addition('doc-6', 'status', '"draft"'));
  expect(new Set(lines)).toEqual(new Set([
    deletion('doc-1', 'status', '"draft"'),
    deletion('doc-2', 'status', '"draft"'),
    addition('doc-1', 'status', '"live"'),
    addition('doc-2', 'status', '"live"'),
    addition('doc-6', 'status', '"live"'),
    addition('doc-6', 'title', '"Key handover"'),
    `A <${EX}doc-6> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${EX}Document> .`,
  ]));
});

/**
 * The boundary, checked as deliberately as the rest.
 *
 * A graph verb has no RDF Patch document to render, and the demo's ninth query
 * is there to show that the app says so rather than showing an empty diff. The
 * record still exists — it is just JSON, not a patch document — so the refusal
 * carries the URL of it.
 */
test('DROP GRAPH refuses a patch document and points at the record', async ({ page, request }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByText('RDF Patch demo', { exact: true }).first().click();
  await page.getByText('Queries', { exact: true }).first().click();
  await page.getByText('9. DROP GRAPH').first().click();
  await page.waitForTimeout(SETTLE_MS);
  await page.getByRole('button', { name: 'Run', exact: true }).click();

  // The refusal is a toast and it dismisses itself in about two seconds, so it
  // is read as soon as it appears rather than after a fixed wait.
  const refusal = page.getByText(/graph-management operation/).first();
  await expect(refusal).toBeVisible({ timeout: 20000 });
  const shown = await refusal.innerText();
  const patchId = shown.match(/urn:sqlib:patch:[0-9a-f]+/)?.[0];
  expect(patchId, 'the refusal names the patch it did record').toBeTruthy();

  const record = await (
    await request.get(`${UAT_API_URL}/patches/${encodeURIComponent(patchId!)}`, {
      headers: { accept: 'application/json' },
    })
  ).json();

  expect(record.applyMode).toBe('graph-ops');
  expect(record.revertible).toBe(false);
  expect(record.graphOps).toHaveLength(1);
  expect(record.graphOps[0]).toMatchObject({
    form: 'drop',
    enumerated: false,
    destination: { kind: 'iri', value: `${EX}archive` },
  });
  // Counted, not enumerated — but counted correctly.
  expect(record.graphOps[0].affectedCount).toBe(8);
});

/**
 * The property the whole feature rests on: previewing is not writing.
 *
 * Run first, then check the store is untouched, then apply the patch that was
 * previewed and check it moved — and revert it, because every spec above reads
 * this same store and the demo is meant to be repeatable.
 *
 * Apply and revert have no UI yet, so they go through the API. That is what
 * this test is for: it is the one that would catch a Run that quietly wrote.
 */
test('previewing leaves the store alone; applying moves it and reverting puts it back', async ({ page, request }) => {
  const liveCount = async (): Promise<number> => {
    const response = await request.get(`${UAT_API_URL}/sparql`, {
      params: {
        query: `SELECT (COUNT(*) AS ?n) WHERE { ?s <${EX}status> "live" }`,
        backendId: BACKEND_ID,
      },
      headers: { accept: 'application/sparql-results+json' },
    });
    return Number((await response.json()).results.bindings[0].n.value);
  };

  const before = await liveCount();
  expect(before, 'the seeded catalogue has one live document').toBe(1);

  const rendered = await runDemoQuery(page, '4. DELETE … INSERT … WHERE');
  const patchId = rendered.match(/urn:sqlib:patch:[0-9a-f]+/)?.[0];
  expect(patchId).toBeTruthy();

  expect(await liveCount(), 'a preview must not write').toBe(before);

  const applied = await request.post(`${UAT_API_URL}/patches/apply`, { data: { patchId } });
  expect(applied.ok()).toBe(true);
  expect(await liveCount(), 'the two promoted drafts are now live').toBe(3);

  const reverted = await request.post(`${UAT_API_URL}/patches/${encodeURIComponent(patchId!)}/revert`, {
    data: {},
  });
  expect(reverted.ok()).toBe(true);
  expect(await liveCount(), 'revert is the patch applied backwards').toBe(before);
});
