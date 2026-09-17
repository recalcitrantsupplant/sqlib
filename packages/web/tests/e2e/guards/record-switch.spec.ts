/**
 * What switching between two saved records costs.
 *
 *   pnpm --filter @sparql-query-lib/web test:perf
 *
 * The sibling `layout-shift.spec.ts` measures a *load*, and the browser's CLS
 * deliberately ignores what this measures: a shift within 500ms of a click
 * carries `hadRecentInput` and is dropped, on the theory that the reader asked
 * for it. A pane that empties and refills when you pick the next row looks
 * exactly like a layout shift to the person watching, so this spec sums the
 * shifts the browser discards rather than the ones it keeps.
 *
 * What it checks, in order of how directly it states the fault:
 *
 *   survives    the pane element itself, marked before the click. A screen
 *               that swaps records in place keeps the node; one rebuilt per id
 *               replaces it, and every field inside starts empty and refills.
 *   shift       layout-shift value during the switch, `hadRecentInput`
 *               included. Near zero when the pane stays; what the pane's whole
 *               height is worth when it does not.
 *   refetches   the lists the *screen* needs rather than the record — queries,
 *               groups, rule sets, backends, data graphs. A record page loads
 *               these on mount, so a row click that fetches them again is the
 *               remount stated as network traffic. Logged and asserted low
 *               rather than zero: the record that arrives has its own work to
 *               do, and this guard is about the pane, not about that.
 *
 * It runs in the functional lane rather than the perf one, although it lives
 * here: the numbers it reads are geometry and request counts, neither of which
 * moves with the machine, and a pane that starts rebuilding itself is a
 * regression worth failing a build over.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { mockEntityApi, LIBRARY, QUERY } from '../fixtures/entities';

const BASE = process.env.PERF_BASE ?? 'http://localhost:3001';

const TEST_IDS = ['urn:sqlib:test:alpha', 'urn:sqlib:test:beta'] as const;

function storedTest(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    subject: QUERY.id,
    subjectKind: 'query',
    criterion: null,
    currentVersion: `${id}:v1`,
    currentVersionNumber: 1,
    isPartOf: [LIBRARY.id],
    tags: [],
    dateCreated: '2026-01-01T00:00:00.000Z',
    dateModified: '2026-01-01T00:00:00.000Z',
  };
}

function storedVersion(id: string) {
  return {
    id: `${id}:v1`,
    isPartOf: id,
    version: 1,
    immutable: true,
    backend: null,
    expectationKind: 'bindings',
    expected: '{"head":{"vars":["s"]},"results":{"bindings":[]}}',
    cases: [{ name: 'Case 1', dataGraph: null, argumentSet: null }],
    dateCreated: '2026-01-01T00:00:00.000Z',
    dateModified: '2026-01-01T00:00:00.000Z',
  };
}

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/** The lists a record page loads once, on mount. */
const SCREEN_LISTS = /\/(queries|query-groups|rule-sets|backends|data-graphs|tags)(\?|$)/;

async function bootstrap(page: Page) {
  await mockEntityApi(page, {
    extraRoutes: [
      [/\/tests\/[^/]+\/versions$/, (r) => json(
        r,
        [storedVersion(decodeURIComponent(new URL(r.request().url()).pathname.split('/')[2]))],
      )],
      [/\/tests\/[^/]+$/, (r) => {
        const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[2]);
        return json(r, storedTest(id, `Test ${TEST_IDS.indexOf(id as typeof TEST_IDS[number]) + 1}`));
      }],
      [/\/tests$/, (r) => json(r, TEST_IDS.map((id, index) => storedTest(id, `Test ${index + 1}`)))],
    ],
  });
}

/** Sums every layout shift, including the ones CLS drops as recent-input. */
async function startShiftObserver(page: Page) {
  await page.evaluate(() => {
    const window_ = window as unknown as { __switchShift: number };
    window_.__switchShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<{ value: number }>) {
        window_.__switchShift += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: false });
  });
}

const shiftSoFar = (page: Page) =>
  page.evaluate(() => (window as unknown as { __switchShift: number }).__switchShift);

test('switching between saved tests swaps in place', async ({ page }) => {
  test.setTimeout(120_000);
  await bootstrap(page);

  const refetches: string[] = [];
  let counting = false;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (counting && SCREEN_LISTS.test(url.pathname)) refetches.push(url.pathname);
  });

  await page.goto(`${BASE}/?section=tests`, { waitUntil: 'networkidle' });
  const row = (name: string) => page.locator('.entity-name', { hasText: name }).first();
  await row('Test 1').click();
  const pane = page.locator('.test-work-area');
  await pane.waitFor();
  await page.waitForTimeout(1_000);

  // A mark on the node, not on anything Vue re-renders: a remount replaces the
  // element and the mark goes with it.
  await pane.evaluate((node) => { (node as HTMLElement).dataset.markedBefore = 'yes'; });

  await startShiftObserver(page);
  counting = true;
  await row('Test 2').click();
  await expect(page.getByTestId('details-name')).toHaveValue('Test 2');
  await page.waitForTimeout(1_500);
  counting = false;

  const shift = await shiftSoFar(page);
  console.log(
    `switch: shift=${shift.toFixed(4)} refetches=${refetches.length} [${[...new Set(refetches)].join(', ')}]`,
  );

  await expect(pane, 'the pane was rebuilt rather than refilled').toHaveAttribute(
    'data-marked-before',
    'yes',
  );
  expect(shift, 'layout shift while switching records').toBeLessThan(0.01);
  expect(refetches.length, 'screen-level lists refetched on a row click').toBeLessThanOrEqual(1);
});
