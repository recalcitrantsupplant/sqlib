/**
 * One fixture library, shared by the three derived-output goldens.
 *
 * `demoPage`, `typings` and `notebook` each render the same bundle into an
 * artifact a consumer keeps — an HTML page, a `.d.ts`, an `.ipynb` — so they are
 * frozen against one input rather than three: a change that moves all three
 * outputs is then one diff to read rather than three to correlate.
 *
 * Every optional field the three generators branch on appears here, and
 * `derivedOutputs.test.ts` checks that it still does. A fixture that quietly
 * stops exercising a branch is a golden that stops testing it.
 */

import { buildExportBundle } from '../../../../src/lib/export/queryBundle.js';
import type { ExportBundle } from '@sparql-query-lib/runtime';

/** Pinned, because `generatedAt` is printed into all three outputs. */
export const FIXTURE_GENERATED_AT = '2026-09-07T00:00:00.000Z';

export const FIXTURE_LIBRARY = {
  id: 'urn:sqlib:library:derived-outputs',
  name: 'Derived Outputs Fixture',
} as const;

/**
 * Four queries, chosen for the branches rather than for the data.
 *
 * - `people-by-city` has a description, one parameter slot and (below) a
 *   recorded example, so it takes the "worked call from an example" path.
 * - `paged-people` carries page parameters, the `limits`/`offsets` branch.
 * - `everything` has no description, no parameters and no example: the
 *   wildcard call, and the `never` unions in the declaration.
 * - `describe-a-person` is not a SELECT, so the notebook's `run()` asks for
 *   Turtle rather than SPARQL JSON.
 */
export const FIXTURE_QUERIES = [
  {
    name: 'People by city',
    description: 'Everyone recorded as living in a given city.',
    sourceVersion: 'urn:sqlib:query-version:people-by-city:1',
    queryString: [
      'PREFIX ex: <http://example.org/>',
      'SELECT ?name WHERE {',
      '  VALUES (?city) { (UNDEF) }',
      '  ?person ex:livesIn ?city ; ex:name ?name',
      '}',
    ].join('\n'),
  },
  {
    name: 'Paged people',
    description: 'Everyone, a page at a time.',
    queryString: 'PREFIX ex: <http://example.org/>\nSELECT ?person WHERE { ?person a ex:Person } LIMIT 0001 OFFSET 0002',
  },
  {
    name: 'Everything',
    queryString: 'SELECT * WHERE { ?s ?p ?o }',
  },
  {
    name: 'Describe a person',
    description: 'The whole record for one person.',
    queryString: 'PREFIX ex: <http://example.org/>\nDESCRIBE ?person WHERE { VALUES (?person) { (UNDEF) } ?person a ex:Person }',
  },
] as const;

/** Left out of the export, and said so on the page and in the notebook. */
export const FIXTURE_SKIPPED = [
  { name: 'Draft query', reason: 'The query has no current version.' },
];

/**
 * One group, chaining two of the queries above.
 *
 * Structural rather than meaningful, like the queries themselves: what it is
 * here for is the shape the page has to draw — a slot the caller fills, a slot
 * an edge fills, a renamed variable across that edge, and a result node that is
 * not a SELECT, so the group cell's result branch is not the SELECT one.
 *
 * Attached after the build for the same reason the route attaches groups there:
 * a group is compiled from the library's stored graph, not from query text.
 */
export const FIXTURE_GROUP = {
  description: 'Everyone in a city, then the whole record for each of them.',
  tags: ['http://example.org/tags/people'],
  nodes: {
    people: { query: 'people-by-city' },
    records: { query: 'describe-a-person' },
  },
  edges: [
    {
      from: 'people',
      to: 'records',
      targetVars: ['person'],
      mappings: [{ source: 'name', target: 'person' }],
    },
  ],
  resultNode: 'records',
} as const;

/**
 * Build the fixture bundle.
 *
 * Examples are attached after the build for the same reason the route attaches
 * them there: they come from the library's tests, not from the query text.
 */
export async function buildFixtureBundle(): Promise<ExportBundle> {
  const bundle = await buildExportBundle({
    library: { ...FIXTURE_LIBRARY },
    queries: FIXTURE_QUERIES.map((query) => ({ ...query })),
    generatedAt: FIXTURE_GENERATED_AT,
  });

  bundle.queries['people-by-city'].examples = [
    {
      name: 'Perth',
      arguments: [
        {
          head: { vars: ['city'] },
          arguments: {
            bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }],
          },
        },
      ],
    },
  ];

  bundle.groups = {
    'people-and-records': {
      ...FIXTURE_GROUP,
      tags: [...FIXTURE_GROUP.tags],
      nodes: { ...FIXTURE_GROUP.nodes },
      edges: FIXTURE_GROUP.edges.map((edge) => ({
        ...edge,
        targetVars: [...edge.targetVars],
        mappings: edge.mappings.map((mapping) => ({ ...mapping })),
      })),
    },
  };

  return bundle;
}
