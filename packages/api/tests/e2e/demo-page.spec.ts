import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { buildExportBundle } from '../../src/lib/export/queryBundle.js';
import { generateDemoPage, loadRuntimeSource } from '../../src/lib/export/demoPage.js';

/**
 * The exported library page, driven in a real browser (issue #261).
 *
 * `demoPage.test.ts` and `libraries.export-bundle.test.ts` cover this file
 * thoroughly, but only as a markup string — nothing renders it. That is
 * exactly the blind spot that let the inlined runtime resolve to unbuilt
 * TypeScript source, or a skeleton payload leave an example-less query
 * red, while every string assertion kept passing. This suite opens the real
 * output with `file://`, as a person who downloaded the export would, with
 * the runtime's actual built bundle inlined rather than a stub.
 *
 * Requires `packages/runtime` to be built first (`pnpm --filter
 * @sparql-query-lib/runtime build`) — `loadRuntimeSource()` fails with a
 * clear message otherwise, same as `export:bundle` does today.
 */

const ENDPOINT = 'http://example.org/sparql';

let pageUrl: string;
let groupPageUrl: string;

test.beforeAll(async () => {
  const bundle = await buildExportBundle({
    library: { id: 'urn:sqlib:library:demo-page-e2e', name: 'Demo Page E2E Library' },
    queries: [
      {
        name: 'Search',
        description: 'Search the catalogue by name',
        tags: ['catalog'],
        queryString: `PREFIX ex: <http://example.org/>
SELECT ?name WHERE {
  VALUES (?term) { (UNDEF) }
  ?item ex:name ?name .
  FILTER(CONTAINS(?name, ?term))
}`,
      },
      {
        name: 'Any in stock',
        description: 'Whether any product is in stock',
        tags: ['stats'],
        queryString: 'PREFIX ex: <http://example.org/>\nASK { ?s ex:inStock true }',
      },
    ],
    generatedAt: '2026-09-05T00:00:00.000Z',
  });

  // A worked example, the shape `attachExamplesToBundle` would otherwise
  // build from a test case — set directly here since this fixture has no
  // library store or tests behind it.
  bundle.queries.search.examples = [
    {
      name: 'jumper',
      arguments: [
        {
          head: { vars: ['term'] },
          arguments: { bindings: [{ term: { type: 'literal', value: 'jumper' } }] },
        },
      ],
    },
  ];

  const html = generateDemoPage(bundle, {
    runtimeSource: loadRuntimeSource(),
    endpoint: ENDPOINT,
  });

  const dir = await mkdtemp(path.join(tmpdir(), 'sqlib-demo-page-'));
  const filePath = path.join(dir, 'library.html');
  await writeFile(filePath, html, 'utf8');
  pageUrl = pathToFileURL(filePath).href;

  groupPageUrl = pathToFileURL(await writeGroupPage(dir)).href;
});

/**
 * A second page, for the group cell.
 *
 * Its own bundle rather than a group bolted onto the one above: a chain wants
 * two queries wired to each other, and the queries above are wired to nothing.
 * The chain is `cities` → `people`: the caller supplies a country, the first
 * node's rows fill the second node's slot, and the second node is the result.
 */
async function writeGroupPage(dir: string): Promise<string> {
  const bundle = await buildExportBundle({
    library: { id: 'urn:sqlib:library:demo-page-groups', name: 'Demo Page Group Library' },
    queries: [
      {
        name: 'Cities',
        description: 'Cities in a country',
        queryString: `PREFIX ex: <http://example.org/>
SELECT ?city WHERE {
  VALUES (?country) { (UNDEF) }
  ?city ex:inCountry ?country .
}`,
      },
      {
        name: 'People',
        description: 'People living in given cities',
        queryString: `PREFIX ex: <http://example.org/>
SELECT ?name WHERE {
  VALUES (?place) { (UNDEF) }
  ?person ex:livesIn ?place ; ex:name ?name .
}`,
      },
    ],
    generatedAt: '2026-09-08T00:00:00.000Z',
  });

  bundle.groups = {
    'people-by-country': {
      description: 'Cities in a country, then everyone living in them.',
      nodes: {
        cities: { query: 'cities' },
        people: { query: 'people' },
      },
      edges: [
        {
          from: 'cities',
          to: 'people',
          targetVars: ['place'],
          mappings: [{ source: 'city', target: 'place' }],
        },
      ],
      resultNode: 'people',
    },
  };

  const filePath = path.join(dir, 'groups.html');
  await writeFile(
    filePath,
    generateDemoPage(bundle, { runtimeSource: loadRuntimeSource(), endpoint: ENDPOINT }),
    'utf8',
  );
  return filePath;
}

/**
 * Answer the two calls a walk makes, in order.
 *
 * The upstream node's rows have to come back as the variable the *edge* reads
 * (`?city`), and the downstream node's query has to arrive carrying them: that
 * splice is the whole of what a group adds, and it happens between these two
 * responses.
 */
async function routeWalk(page: import('@playwright/test').Page, sent: string[]) {
  await page.route(/^http:\/\/example\.org\/sparql/, (route) => {
    const request = route.request();
    const body = request.postData() ?? new URL(request.url()).searchParams.get('query') ?? '';
    sent.push(body);
    const first = sent.length === 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/sparql-results+json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(
        first
          ? {
              head: { vars: ['city'] },
              results: {
                bindings: [
                  { city: { type: 'uri', value: 'http://example.org/Perth' } },
                  { city: { type: 'uri', value: 'http://example.org/Hobart' } },
                ],
              },
            }
          : {
              head: { vars: ['name'] },
              results: { bindings: [{ name: { type: 'literal', value: 'Blue jumper' } }] },
            },
      ),
    });
  });
}

test('loads with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(pageUrl);
  await expect(page.locator('#args-search table')).toBeVisible();

  expect(errors).toEqual([]);
});

test('upgrades <sqlib-args> and dresses it in a stylesheet, not the browser defaults', async ({
  page,
}) => {
  await page.goto(pageUrl);
  const input = page.locator('#args-search .sqlib-args__cell input').first();
  await expect(input).toBeVisible();
  // An unstyled input has no border-radius and the UA's own font. Either one
  // alone could be coincidence; together they say ARGS_ELEMENT_STYLES landed.
  const style = await input.evaluate((el) => {
    const computed = getComputedStyle(el);
    return { radius: computed.borderRadius, family: computed.fontFamily };
  });
  expect(style.radius).not.toBe('0px');
  expect(style.family.toLowerCase()).toContain('mono');
});

test('substitutes the first example on arrival', async ({ page }) => {
  await page.goto(pageUrl);
  await expect(page.locator('#sub-search')).toContainText('"jumper"');
});

test('re-substitutes as the argument is edited by hand', async ({ page }) => {
  await page.goto(pageUrl);
  await page.locator('#args-search .sqlib-args__cell input').first().fill('scarf');
  await expect(page.locator('#sub-search')).toContainText('"scarf"');
});

test('disables Run for an argument that cannot be substituted, and says why', async ({ page }) => {
  await page.goto(pageUrl);
  const cell = page.locator('#args-search .sqlib-args__cell').first();
  await cell.locator('select').selectOption('uri');
  await cell.locator('input').fill('not an iri');
  await expect(page.locator('#run-search')).toBeDisabled();
});

test('runs against the typed-in endpoint and renders a result table', async ({ page }) => {
  await page.route(/^http:\/\/example\.org\/sparql/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/sparql-results+json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        head: { vars: ['name'] },
        results: { bindings: [{ name: { type: 'literal', value: 'Blue jumper' } }] },
      }),
    }),
  );

  await page.goto(pageUrl);
  await page.locator('#run-search').click();

  await expect(page.locator('#status-search')).toContainText('ran in');
  const rows = page.locator('#res-search table tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Blue jumper');
});

test('filters cells and rail entries by tag', async ({ page }) => {
  await page.goto(pageUrl);
  await page.locator('[data-tag="catalog"]').click();
  await expect(page.locator('#q-search')).toBeVisible();
  await expect(page.locator('#q-any-in-stock')).toBeHidden();
});

test('filters cells and rail entries by free text', async ({ page }) => {
  await page.goto(pageUrl);
  await page.locator('#filter-text').fill('catalogue');
  await expect(page.locator('#q-search')).toBeVisible();
  await expect(page.locator('#q-any-in-stock')).toBeHidden();
});

/*
 * The group cell.
 *
 * Everything below needs the real runtime: a group's argument grid is built
 * from the walker's own signature, and its Run walks the chain — two calls, the
 * first node's rows spliced into the second node's query. Nothing about that is
 * visible in a markup assertion, which is why the walk is driven here.
 */

test('builds the group argument grid from the slots no edge fills', async ({ page }) => {
  await page.goto(groupPageUrl);
  const cells = page.locator('#gargs-people-by-country .sqlib-args__cell');
  // One slot: `?country`, which the caller supplies. `?place` is filled by the
  // edge from `cities`, so the grid must not ask for it.
  await expect(cells).toHaveCount(1);
  await expect(page.locator('#g-people-by-country')).toContainText('?country from you');
  await expect(page.locator('#g-people-by-country')).toContainText('?city→?place from cities');
});

test('walks the chain against the endpoint and renders the result node&#39;s rows', async ({
  page,
}) => {
  const sent: string[] = [];
  await routeWalk(page, sent);

  await page.goto(groupPageUrl);
  // A group has no examples of its own, so its grid opens all-UNDEF: the kind
  // comes first, and the input appears with it.
  const cell = page.locator('#gargs-people-by-country .sqlib-args__cell').first();
  await cell.locator('select').selectOption('uri');
  await cell.locator('input').first().fill('http://example.org/Australia');
  await page.locator('#grun-people-by-country').click();

  await expect(page.locator('#gstatus-people-by-country')).toContainText('ran in');
  const rows = page.locator('#gres-people-by-country table tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Blue jumper');

  // Two nodes, two calls: the caller's term reached the first, and the first
  // node's rows reached the second under the edge's target name.
  expect(sent).toHaveLength(2);
  expect(sent[0]).toContain('Australia');
  expect(sent[1]).toContain('Perth');
  expect(sent[1]).toContain('Hobart');
  expect(sent[1]).toContain('?place');
});

test('shows what each step ran, once the walk has happened', async ({ page }) => {
  const sent: string[] = [];
  await routeWalk(page, sent);

  await page.goto(groupPageUrl);
  // Nothing to show before a run: every node past the first takes its rows from
  // the node above, so there is no substituted text to preview.
  await expect(page.locator('#gran-people-by-country details')).toHaveCount(0);

  await page.locator('#grun-people-by-country').click();
  const steps = page.locator('#gran-people-by-country details');
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(0)).toContainText('cities · cities');
  await expect(steps.nth(1)).toContainText('people · people');
  await steps.nth(1).locator('summary').click();
  await expect(steps.nth(1).locator('pre')).toContainText('Perth');
});

test('reports a walk that fails without leaving the button dead', async ({ page }) => {
  await page.route(/^http:\/\/example\.org\/sparql/, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'text/plain',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'upstream exploded',
    }),
  );

  await page.goto(groupPageUrl);
  await page.locator('#grun-people-by-country').click();
  await expect(page.locator('#gstatus-people-by-country')).toContainText('failed');
  await expect(page.locator('#gres-people-by-country pre.error')).toContainText('500');
  await expect(page.locator('#grun-people-by-country')).toBeEnabled();
});

test('loads the group page with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(groupPageUrl);
  await expect(page.locator('#gargs-people-by-country table')).toBeVisible();
  expect(errors).toEqual([]);
});
