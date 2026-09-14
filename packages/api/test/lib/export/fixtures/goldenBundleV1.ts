/**
 * The inputs behind the committed bundle-format fixture.
 *
 * `packages/runtime/test/fixtures/bundle-v1.json` is a real bundle: this module
 * is what produced it, and `bundleFormat.test.ts` re-runs it on every CI run and
 * compares. So the fixture is not a hand-written approximation of the format —
 * it is what `GET /libraries/:id/export` writes, frozen.
 *
 * Two things it is built to be:
 *
 * - **Complete.** Every optional field in the format appears somewhere in it, so
 *   a reader that stops tolerating one of them fails a test rather than failing
 *   at a consumer's site. A new optional field is only covered once it is added
 *   here, and it cannot be added to the writer without showing up in the
 *   fixture's diff — which is the moment to notice it needs covering.
 * - **The route's own call order.** `buildExportBundle`, then examples, then
 *   groups, exactly as `routes/libraries.ts` does it, because the order decides
 *   which queries carry examples: a group may bring a query of its own into the
 *   bundle after the examples have been attached.
 *
 * The one deliberate difference from the route is `generatedAt`, which is fixed
 * here. Everything else — the slugging, the key collisions, the reuse of a query
 * a group pins the version of — is the real path.
 */

import type { ExportBundle } from '@sparql-query-lib/runtime';
import { buildExportBundle } from '../../../../src/lib/export/queryBundle.js';
import { attachGroupsToBundle } from '../../../../src/lib/export/groupBundle.js';
import {
  attachExamplesToBundle,
  type ExampleSource,
  type ResolvedArgumentPayload,
} from '../../../../src/lib/export/collectQueryExamples.js';
import type { ExportGroupInput } from '../../../../src/lib/export/collectLibraryGroups.js';
import type { LdkitTest } from '../../../../src/persistence/schemas/TestSchema.js';
import type { LdkitTestVersion } from '../../../../src/persistence/schemas/TestVersionSchema.js';
import type { LdkitTestCase } from '../../../../src/persistence/schemas/TestCaseSchema.js';

const LIBRARY = { id: 'urn:sqlib:library:golden', name: 'Golden fixture library' };

/** The tag the export was filtered by, so `bundle.tags` is exercised. */
const FILTER_TAGS = ['urn:sqlib:tag:reference'];

const QUERY_PEOPLE = 'urn:sqlib:query:people-by-city';
const QUERY_PAGED = 'urn:sqlib:query:paged-things';
const QUERY_LABELS = 'urn:sqlib:query:labels';
const VERSION_PEOPLE = 'urn:sqlib:query-version:people-by-city-1';

/** One parameter slot, and a second variable in the projection. */
const PEOPLE_BY_CITY = `PREFIX ex: <http://example.org/>
SELECT ?name ?city WHERE {
  VALUES (?city) { (UNDEF) }
  ?person ex:livesIn ?city ; ex:name ?name .
}`;

/**
 * A slot and both page-parameter placeholders, so `pageParameters` is in the
 * fixture. `LIMIT 0001` is the spelling the compiler's sentinel pass is built
 * around; see `locatePageParameters`.
 */
const PAGED_THINGS = `PREFIX ex: <http://example.org/>
SELECT ?s WHERE {
  VALUES (?type) { (UNDEF) }
  ?s a ?type .
}
LIMIT 0001 OFFSET 0002`;

/** No slots and not a SELECT: `inferredInputs: []` and a second query form. */
const LABELS = `PREFIX ex: <http://example.org/>
CONSTRUCT { ?s ex:label ?name } WHERE { ?s ex:name ?name }`;

/** The query a group brings into the bundle with it. */
const CITIES_IN_REGION = `PREFIX ex: <http://example.org/>
SELECT ?city WHERE {
  VALUES (?region) { (UNDEF) }
  ?city ex:inRegion ?region .
}`;

const QUERIES = [
  {
    name: 'People by city',
    queryString: PEOPLE_BY_CITY,
    sourceQuery: QUERY_PEOPLE,
    sourceVersion: VERSION_PEOPLE,
    description: 'Everyone living in the given cities.',
    tags: FILTER_TAGS,
  },
  {
    name: 'Paged things',
    queryString: PAGED_THINGS,
    sourceQuery: QUERY_PAGED,
    sourceVersion: 'urn:sqlib:query-version:paged-things-1',
  },
  {
    name: 'Labels',
    queryString: LABELS,
    sourceQuery: QUERY_LABELS,
    sourceVersion: 'urn:sqlib:query-version:labels-1',
  },
];

/**
 * A group whose second node pins the version the library query was compiled
 * from, so the bundle reuses that entry rather than carrying the text twice —
 * the behaviour `compileGroup` documents, and the one a hand-written fixture
 * would never happen to reproduce.
 */
const GROUP: ExportGroupInput = {
  name: 'People by region',
  description: 'Cities in a region, then everyone living in them.',
  tags: FILTER_TAGS,
  sourceGroup: 'urn:sqlib:query-group:people-by-region',
  sourceVersion: 'urn:sqlib:query-group-version:people-by-region-1',
  nodes: [
    {
      key: 'cities',
      sourceNode: 'urn:sqlib:query-node:cities',
      name: 'Cities in region',
      queryString: CITIES_IN_REGION,
      sourceQuery: 'urn:sqlib:query:cities-in-region',
      sourceVersion: 'urn:sqlib:query-version:cities-in-region-1',
      description: 'Every city in the given regions.',
      tags: FILTER_TAGS,
    },
    {
      key: 'people',
      sourceNode: 'urn:sqlib:query-node:people',
      name: 'People by city',
      queryString: PEOPLE_BY_CITY,
      sourceQuery: QUERY_PEOPLE,
      sourceVersion: VERSION_PEOPLE,
    },
  ],
  edges: [
    {
      from: 'cities',
      to: 'people',
      targetVars: ['city'],
      mappings: [{ source: 'city', target: 'city' }],
      whenEmpty: 'propagateEmpty',
      sourceEdge: 'urn:sqlib:query-edge:cities-to-people',
    },
  ],
  resultNode: 'people',
};

const PAYLOADS: Record<string, ResolvedArgumentPayload> = {
  'urn:sqlib:argument-set-version:perth': {
    arguments: [
      {
        head: { vars: ['city'] },
        arguments: {
          bindings: [{ city: { type: 'uri', value: 'http://example.org/city/perth' } }],
        },
      },
    ],
    limits: [],
    offsets: [],
  },
  'urn:sqlib:argument-set-version:cities': {
    arguments: [
      {
        head: { vars: ['city'] },
        arguments: {
          bindings: [
            { city: { type: 'uri', value: 'http://example.org/city/perth' } },
            { city: { type: 'uri', value: 'http://example.org/city/darwin' } },
          ],
        },
      },
    ],
    limits: [],
    offsets: [],
  },
  // The only payload carrying page parameters, so `limits` and `offsets` on an
  // example are exercised. The names are what the placeholders resolve to.
  'urn:sqlib:argument-set-version:first-page': {
    arguments: [
      {
        head: { vars: ['type'] },
        arguments: {
          bindings: [{ type: { type: 'uri', value: 'http://example.org/City' } }],
        },
      },
    ],
    limits: [{ name: '1', value: 25 }],
    offsets: [{ name: '2', value: 50 }],
  },
};

const asTest = (partial: Partial<LdkitTest> & { $id: string; name: string; subject: string }) =>
  ({
    subjectKind: 'query',
    isPartOf: [LIBRARY.id],
    currentVersion: `${partial.$id}:v1`,
    ...partial,
  }) as LdkitTest;

const asVersion = (testId: string, cases: string[]) =>
  ({
    $id: `${testId}:v1`,
    isPartOf: testId,
    version: 1,
    expectationKind: 'bindings',
    cases,
  }) as LdkitTestVersion;

const asCase = (partial: Partial<LdkitTestCase> & { $id: string; isPartOf: string }) =>
  ({ position: 0, ...partial }) as LdkitTestCase;

const TESTS = [
  asTest({ $id: 'urn:sqlib:test:people', name: 'People by city returns rows', subject: QUERY_PEOPLE }),
  asTest({ $id: 'urn:sqlib:test:paged', name: 'Paged things pages', subject: QUERY_PAGED }),
  asTest({ $id: 'urn:sqlib:test:labels', name: 'Labels are built', subject: QUERY_LABELS }),
];

const VERSIONS: Record<string, LdkitTestVersion> = {
  'urn:sqlib:test:people:v1': asVersion('urn:sqlib:test:people', [
    'urn:sqlib:test-case:perth',
    'urn:sqlib:test-case:seeded',
  ]),
  'urn:sqlib:test:paged:v1': asVersion('urn:sqlib:test:paged', ['urn:sqlib:test-case:first-page']),
  'urn:sqlib:test:labels:v1': asVersion('urn:sqlib:test:labels', ['urn:sqlib:test-case:no-args']),
};

const CASES: Record<string, LdkitTestCase> = {
  // Named, with a recorded answer: `expected` and `expectedFormat`.
  'urn:sqlib:test-case:perth': asCase({
    $id: 'urn:sqlib:test-case:perth',
    isPartOf: 'urn:sqlib:test:people:v1',
    name: 'Perth',
    argumentSetVersion: 'urn:sqlib:argument-set-version:perth',
    expected: '{"head":{"vars":["name","city"]},"results":{"bindings":[]}}',
    expectedFormat: 'application/sparql-results+json',
  }),
  // Unnamed and seeded: the `<test name> #<position>` naming rule, and
  // `dataDependent`, which says the expectation means nothing elsewhere.
  'urn:sqlib:test-case:seeded': asCase({
    $id: 'urn:sqlib:test-case:seeded',
    isPartOf: 'urn:sqlib:test:people:v1',
    position: 1,
    argumentSetVersion: 'urn:sqlib:argument-set-version:cities',
    dataGraphVersion: 'urn:sqlib:data-graph-version:cities-1',
  }),
  'urn:sqlib:test-case:first-page': asCase({
    $id: 'urn:sqlib:test-case:first-page',
    isPartOf: 'urn:sqlib:test:paged:v1',
    name: 'First page',
    argumentSetVersion: 'urn:sqlib:argument-set-version:first-page',
  }),
  // No arguments, which is legal for a query with no slots.
  'urn:sqlib:test-case:no-args': asCase({
    $id: 'urn:sqlib:test-case:no-args',
    isPartOf: 'urn:sqlib:test:labels:v1',
    name: 'All labels',
  }),
};

const EXAMPLE_SOURCE: ExampleSource = {
  listTests: () => TESTS,
  getTestVersion: (id) => VERSIONS[id] ?? null,
  getTestCase: (id) => CASES[id] ?? null,
  resolveArgumentPayload: async (id) => {
    const payload = PAYLOADS[id];
    if (!payload) throw new Error(`No fixture payload for ${id}`);
    return payload;
  },
};

/** The export timestamp, fixed so the fixture is reproducible. */
export const GOLDEN_GENERATED_AT = '2026-09-07T00:00:00.000Z';

/**
 * Build the golden bundle: the route's three steps over the fixture library.
 *
 * Anything that could not be exported is a defect in the fixture rather than a
 * skip to report, so a non-empty skip list throws — a fixture that quietly
 * stopped carrying its group would still have been a valid bundle, and the
 * comparison would have passed once someone re-ran the update.
 */
export async function buildGoldenBundleV1(): Promise<ExportBundle> {
  const bundle = await buildExportBundle({
    library: LIBRARY,
    queries: QUERIES,
    tags: FILTER_TAGS,
    generatedAt: GOLDEN_GENERATED_AT,
  });

  const { skipped: skippedExamples } = await attachExamplesToBundle(
    bundle,
    EXAMPLE_SOURCE,
    LIBRARY.id,
    { mode: 'all', includeExpected: true },
  );
  const { skipped: skippedGroups } = await attachGroupsToBundle(bundle, [GROUP]);

  const skipped = [...skippedExamples, ...skippedGroups];
  if (skipped.length > 0) {
    throw new Error(
      `The golden fixture skipped something, so it no longer covers the format: ${skipped
        .map((entry) => `${entry.name} (${entry.reason})`)
        .join('; ')}`,
    );
  }

  return bundle;
}
