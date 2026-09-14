import { describe, expect, it } from 'vitest';
import { fromBundle, iri, verifyBundleIntegrity } from '@sparql-query-lib/runtime';
import type { ExecutionResult, Executor } from '@sparql-query-lib/runtime';
import { buildExportBundle } from '../../../src/lib/export/queryBundle.js';
import { attachGroupsToBundle } from '../../../src/lib/export/groupBundle.js';
import type { ExportGroupInput } from '../../../src/lib/export/collectLibraryGroups.js';

const LIBRARY = { id: 'urn:sqlib:library:main', name: 'Main' };

const CITIES = `
PREFIX ex: <http://example.org/>
SELECT ?city WHERE {
  VALUES (?region) { (UNDEF) }
  ?city ex:inRegion ?region .
}`;

const PEOPLE = `
PREFIX ex: <http://example.org/>
SELECT ?name WHERE {
  VALUES (?place) { (UNDEF) }
  ?person ex:livesIn ?place ; ex:name ?name .
}`;

function group(overrides: Partial<ExportGroupInput> = {}): ExportGroupInput {
  return {
    name: 'People by region',
    sourceGroup: 'g1',
    sourceVersion: 'gv1',
    nodes: [
      {
        key: 'cities',
        sourceNode: 'n1',
        name: 'Cities in region',
        queryString: CITIES,
        sourceQuery: 'q1',
        sourceVersion: 'qv1',
      },
      {
        key: 'people',
        sourceNode: 'n2',
        name: 'People in place',
        queryString: PEOPLE,
        sourceQuery: 'q2',
        sourceVersion: 'qv2',
      },
    ],
    edges: [
      {
        from: 'cities',
        to: 'people',
        targetVars: ['place'],
        mappings: [{ source: 'city', target: 'place' }],
        sourceEdge: 'e1',
      },
    ],
    resultNode: 'people',
    ...overrides,
  };
}

/** A bundle holding the library's own queries, compiled the usual way. */
async function libraryBundle(
  queries: Array<{ name: string; queryString: string; sourceVersion?: string }> = [],
) {
  return buildExportBundle({
    library: LIBRARY,
    queries,
    generatedAt: '2026-08-25T00:00:00.000Z',
  });
}

describe('attachGroupsToBundle', () => {
  it('compiles a group and the queries its nodes pin', async () => {
    const bundle = await libraryBundle();
    const { skipped } = await attachGroupsToBundle(bundle, [group()]);

    expect(skipped).toEqual([]);
    expect(Object.keys(bundle.queries).sort()).toEqual(['cities-in-region', 'people-in-place']);
    expect(bundle.groups?.['people-by-region']).toEqual({
      name: 'People by region',
      nodes: {
        cities: { query: 'cities-in-region', sourceNode: 'n1' },
        people: { query: 'people-in-place', sourceNode: 'n2' },
      },
      edges: [
        {
          from: 'cities',
          to: 'people',
          targetVars: ['place'],
          mappings: [{ source: 'city', target: 'place' }],
          sourceEdge: 'e1',
        },
      ],
      resultNode: 'people',
      sourceGroup: 'g1',
      sourceVersion: 'gv1',
    });

    // The queries a group brought in are ordinary bundle entries: hashed,
    // callable, and covered by the integrity check like any other.
    await verifyBundleIntegrity(bundle);
  });

  it('reuses the library entry a node pins rather than compiling it twice', async () => {
    const bundle = await libraryBundle([
      { name: 'People in place', queryString: PEOPLE, sourceVersion: 'qv2' },
    ]);
    await attachGroupsToBundle(bundle, [group()]);

    expect(Object.keys(bundle.queries).sort()).toEqual(['cities-in-region', 'people-in-place']);
    expect(bundle.groups?.['people-by-region'].nodes.people.query).toBe('people-in-place');
  });

  it('adds a second entry when a node pins a version the library does not publish', async () => {
    // Same name, different version: the group's node is not the library's
    // current text, so it gets its own entry rather than silently sharing one.
    const bundle = await libraryBundle([
      { name: 'People in place', queryString: 'SELECT * { ?s ?p ?o }', sourceVersion: 'qv9' },
    ]);
    await attachGroupsToBundle(bundle, [group()]);

    expect(Object.keys(bundle.queries).sort()).toEqual([
      'cities-in-region',
      'people-in-place',
      'people-in-place-2',
    ]);
    expect(bundle.groups?.['people-by-region'].nodes.people.query).toBe('people-in-place-2');
  });

  it('reports a group whose edge fills a slot its query no longer declares', async () => {
    const bundle = await libraryBundle();
    const { skipped } = await attachGroupsToBundle(bundle, [
      group({
        edges: [
          {
            from: 'cities',
            to: 'people',
            targetVars: ['town'],
            mappings: [{ source: 'city', target: 'town' }],
            sourceEdge: 'e1',
          },
        ],
      }),
    ]);

    expect(skipped[0].reason).toContain('declares no such parameter slot');
    expect(bundle.groups).toBeUndefined();
    // Nothing half-added: the group's queries went in with the group or not at all.
    expect(bundle.queries).toEqual({});
  });

  it('reports a group that chains a form producing no rows', async () => {
    const bundle = await libraryBundle();
    const { skipped } = await attachGroupsToBundle(bundle, [
      group({
        nodes: [
          {
            key: 'cities',
            sourceNode: 'n1',
            name: 'Cities in region',
            queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
            sourceVersion: 'qv1',
          },
          group().nodes[1],
        ],
      }),
    ]);

    expect(skipped[0].reason).toContain('chains a CONSTRUCT');
  });

  it('reports a group whose node query cannot be compiled, and keeps the rest', async () => {
    const bundle = await libraryBundle();
    const { skipped } = await attachGroupsToBundle(bundle, [
      group({
        name: 'Broken',
        sourceGroup: 'g0',
        nodes: [
          {
            key: 'cities',
            sourceNode: 'n1',
            name: 'Not a query',
            queryString: 'this is not SPARQL',
            sourceVersion: 'qvX',
          },
          group().nodes[1],
        ],
      }),
      group(),
    ]);

    expect(skipped.map((entry) => entry.name)).toEqual(['Broken']);
    expect(Object.keys(bundle.groups ?? {})).toEqual(['people-by-region']);
  });

  it('leaves a bundle with no groups untouched', async () => {
    const bundle = await libraryBundle();
    const { skipped } = await attachGroupsToBundle(bundle, []);
    expect(skipped).toEqual([]);
    expect(bundle.groups).toBeUndefined();
  });
});

describe('the exported group, walked by the runtime', () => {
  it('chains the upstream rows into the downstream slot', async () => {
    const bundle = await libraryBundle();
    await attachGroupsToBundle(bundle, [group()]);

    const seen: string[] = [];
    const executor: Executor = {
      async execute({ queryText }): Promise<ExecutionResult> {
        seen.push(queryText);
        return queryText.includes('?city')
          ? {
              head: { vars: ['city'] },
              results: {
                bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }],
              },
            }
          : {
              head: { vars: ['name'] },
              results: { bindings: [{ name: { type: 'literal', value: 'Ada' } }] },
            };
      },
    };

    const result = await fromBundle(bundle, { executor })
      .group('people-by-region')
      .run({
        arguments: [
          {
            head: { vars: ['region'] },
            arguments: { bindings: [{ region: iri('http://example.org/WA') }] },
          },
        ],
      });

    // Both hops substituted through the same compiled templates the server
    // verified, prefix table included.
    expect(seen[0]).toContain('VALUES ?region { ex:WA }');
    expect(seen[1]).toContain('VALUES ?place { ex:Perth }');
    expect(result).toEqual({
      head: { vars: ['name'] },
      results: { bindings: [{ name: { type: 'literal', value: 'Ada' } }] },
    });
  });
});
