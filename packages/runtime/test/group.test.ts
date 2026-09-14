import { describe, expect, it } from 'vitest';
import { InvalidBundleError } from '../src/bundle.js';
import type { ExportBundle, ExportedGroup } from '../src/bundle.js';
import { QueryCallError, fromBundle, iri, literal } from '../src/library.js';
import type { ExecutionResult, Executor } from '../src/executor.js';
import { bundleOf, exportedQuery, template } from './helpers.js';

/** Upstream: the cities a region contains. Its slot is filled by the caller. */
const REGIONS = () =>
  template('SELECT ?city WHERE { «VALUES ?region { UNDEF }» ?city :inRegion ?region }');

/** Downstream: people in those cities. Its slot is filled by the edge. */
const PEOPLE = () =>
  template('SELECT ?name WHERE { «VALUES ?place { UNDEF }» ?p :livesIn ?place ; :name ?name }');

function rows(variable: string, ...values: string[]) {
  return {
    head: { vars: [variable] },
    results: {
      bindings: values.map((value) => ({ [variable]: { type: 'uri' as const, value } })),
    },
  };
}

/**
 * An executor that answers by what the query selects, and keeps every query it
 * was handed — the walk is the thing under test, so what each node sent matters
 * as much as what came back.
 */
function recordingExecutor(answers: Record<string, ExecutionResult>) {
  const seen: string[] = [];
  const executor: Executor = {
    async execute({ queryText }) {
      seen.push(queryText);
      const match = Object.keys(answers).find((marker) => queryText.includes(marker));
      if (!match) throw new Error(`No canned answer for: ${queryText}`);
      return answers[match];
    },
  };
  return { executor, seen };
}

async function chainBundle(overrides: Partial<ExportedGroup> = {}): Promise<ExportBundle> {
  const bundle = await bundleOf({ regions: REGIONS(), people: PEOPLE() });
  return {
    ...bundle,
    groups: {
      'people-by-region': {
        name: 'People by region',
        nodes: { cities: { query: 'regions' }, people: { query: 'people' } },
        edges: [
          {
            from: 'cities',
            to: 'people',
            targetVars: ['place'],
            mappings: [{ source: 'city', target: 'place' }],
          },
        ],
        resultNode: 'people',
        ...overrides,
      },
    },
  };
}

describe('walking a group', () => {
  it('splices the upstream rows into the downstream slot', async () => {
    const { executor, seen } = recordingExecutor({
      '?city': rows('city', 'http://example.org/Perth'),
      '?name': rows('name', 'http://example.org/Ada'),
    });
    const group = fromBundle(await chainBundle(), { executor }).group('people-by-region');

    const result = await group.run({
      arguments: [
        {
          head: { vars: ['region'] },
          arguments: { bindings: [{ region: iri('http://example.org/WA') }] },
        },
      ],
    });

    expect(seen[0]).toContain('VALUES ?region { <http://example.org/WA> }');
    expect(seen[1]).toContain('VALUES ?place { <http://example.org/Perth> }');
    expect(result).toEqual(rows('name', 'http://example.org/Ada'));
  });

  it('keeps every node result and the query each node ran', async () => {
    const { executor } = recordingExecutor({
      '?city': rows('city', 'http://example.org/Perth'),
      '?name': rows('name', 'http://example.org/Ada'),
    });
    const group = fromBundle(await chainBundle(), { executor }).group('people-by-region');

    const detailed = await group.runDetailed({
      arguments: [
        { head: { vars: ['region'] }, arguments: { bindings: [{ region: iri('urn:wa') }] } },
      ],
    });

    expect(Object.keys(detailed.nodes).sort()).toEqual(['cities', 'people']);
    expect(detailed.texts.people).toContain('VALUES ?place { <http://example.org/Perth> }');
    expect(detailed.result).toBe(detailed.nodes.people);
  });

  it('reports the slots a caller has to fill, and the page parameters on offer', async () => {
    const group = fromBundle(await chainBundle()).group('people-by-region');
    expect(group.signature()).toEqual({
      inputs: [{ node: 'cities', vars: ['region'] }],
      limitParameters: [],
      offsetParameters: [],
    });
    expect(group.nodes()).toEqual(['cities', 'people']);
    expect(group.resultNode).toBe('people');
  });

  it('renames a column across the edge, as the stored mapping says', async () => {
    const { executor, seen } = recordingExecutor({
      '?city': rows('city', 'http://example.org/Perth'),
      '?name': rows('name', 'http://example.org/Ada'),
    });
    await fromBundle(await chainBundle(), { executor })
      .group('people-by-region')
      .run({ arguments: [{ head: { vars: ['region'] }, arguments: { bindings: [] } }] });

    // ?city upstream, ?place downstream: the mapping is the only reason the row
    // lands in the slot at all.
    expect(seen[1]).toContain('VALUES ?place { <http://example.org/Perth> }');
  });

  it('unions two edges into one slot, dropping the duplicate row', async () => {
    const base = await bundleOf({
      regions: REGIONS(),
      towns: template('SELECT ?town WHERE { ?town a :Town }'),
      people: PEOPLE(),
    });
    const bundle: ExportBundle = {
      ...base,
      groups: {
        both: {
          nodes: {
            cities: { query: 'regions' },
            towns: { query: 'towns' },
            people: { query: 'people' },
          },
          edges: [
            {
              from: 'cities',
              to: 'people',
              targetVars: ['place'],
              mappings: [{ source: 'city', target: 'place' }],
            },
            {
              from: 'towns',
              to: 'people',
              targetVars: ['place'],
              mappings: [{ source: 'town', target: 'place' }],
            },
          ],
          resultNode: 'people',
        },
      },
    };

    const { executor, seen } = recordingExecutor({
      '?city': rows('city', 'http://example.org/Perth'),
      '?town': rows('town', 'http://example.org/Perth', 'http://example.org/Albany'),
      '?name': rows('name', 'http://example.org/Ada'),
    });
    await fromBundle(bundle, { executor })
      .group('both')
      .run({ arguments: [{ head: { vars: ['region'] }, arguments: { bindings: [] } }] });

    const downstream = seen[seen.length - 1];
    expect(downstream).toContain(
      'VALUES ?place { <http://example.org/Perth> <http://example.org/Albany> }',
    );
  });

  it('leaves an unmapped upstream cell UNDEF rather than failing', async () => {
    const base = await bundleOf({
      pairs: template('SELECT ?city ?year WHERE { ?city :founded ?year }'),
      report: template('SELECT * { «VALUES( ?place ?year ){ ( UNDEF UNDEF ) }» ?s ?p ?o }'),
    });
    const bundle: ExportBundle = {
      ...base,
      groups: {
        report: {
          nodes: { source: { query: 'pairs' }, sink: { query: 'report' } },
          edges: [
            {
              from: 'source',
              to: 'sink',
              targetVars: ['place', 'year'],
              mappings: [
                { source: 'city', target: 'place' },
                { source: 'year', target: 'year' },
              ],
            },
          ],
          resultNode: 'sink',
        },
      },
    };

    const { executor, seen } = recordingExecutor({
      '?city ?year': {
        head: { vars: ['city', 'year'] },
        results: { bindings: [{ city: iri('http://example.org/Perth') }] },
      },
      'VALUES( ?place ?year )': rows('s', 'http://example.org/anything'),
    });
    await fromBundle(bundle, { executor }).group('report').run();

    expect(seen[1]).toContain('( <http://example.org/Perth> UNDEF )');
  });

  it('refuses to chain a term a VALUES block cannot carry', async () => {
    const { executor } = recordingExecutor({
      '?city': {
        head: { vars: ['city'] },
        results: { bindings: [{ city: { type: 'bnode', value: 'b0' } as never }] },
      },
      '?name': rows('name', 'http://example.org/Ada'),
    });

    await expect(
      fromBundle(await chainBundle(), { executor })
        .group('people-by-region')
        .run(),
    ).rejects.toThrow(/bnode, which cannot be chained/);
  });

  it('refuses to chain a node that did not return rows', async () => {
    const { executor } = recordingExecutor({
      '?city': { head: {}, boolean: true },
      '?name': rows('name', 'http://example.org/Ada'),
    });

    await expect(
      fromBundle(await chainBundle(), { executor })
        .group('people-by-region')
        .run(),
    ).rejects.toThrow(/needs SELECT results/);
  });
});

describe('empty upstreams', () => {
  const empty = () => ({ head: { vars: ['city'] }, results: { bindings: [] } });

  it('propagates an empty upstream as a zero-row block by default', async () => {
    const { executor, seen } = recordingExecutor({
      '?city': empty(),
      '?name': rows('name', 'http://example.org/Ada'),
    });
    await fromBundle(await chainBundle(), { executor })
      .group('people-by-region')
      .run();

    expect(seen[1]).toContain('VALUES ?place { }');
  });

  it('runs the downstream open when the edge says unconstrained', async () => {
    const bundle = await chainBundle({
      edges: [
        {
          from: 'cities',
          to: 'people',
          targetVars: ['place'],
          mappings: [{ source: 'city', target: 'place' }],
          whenEmpty: 'unconstrained',
        },
      ],
    });
    const { executor, seen } = recordingExecutor({
      '?city': empty(),
      '?name': rows('name', 'http://example.org/Ada'),
    });
    await fromBundle(bundle, { executor }).group('people-by-region').run();

    expect(seen[1]).not.toContain('VALUES');
  });

  it('fails the run when the edge says the input is required', async () => {
    const bundle = await chainBundle({
      edges: [
        {
          from: 'cities',
          to: 'people',
          targetVars: ['place'],
          mappings: [{ source: 'city', target: 'place' }],
          whenEmpty: 'require',
        },
      ],
    });
    const { executor } = recordingExecutor({
      '?city': empty(),
      '?name': rows('name', 'http://example.org/Ada'),
    });

    await expect(fromBundle(bundle, { executor }).group('people-by-region').run()).rejects.toThrow(
      /Required input/,
    );
  });

  it('runs a slot nobody filled open, the way an absent parameter runs', async () => {
    const { executor, seen } = recordingExecutor({
      '?city': rows('city', 'http://example.org/Perth'),
      '?name': rows('name', 'http://example.org/Ada'),
    });
    await fromBundle(await chainBundle(), { executor })
      .group('people-by-region')
      .run();

    expect(seen[0]).not.toContain('VALUES');
  });
});

describe('a group call', () => {
  it('offers page parameters only to the node that declares them', async () => {
    const base = await bundleOf({
      regions: template(
        'SELECT ?city WHERE { «VALUES ?region { UNDEF }» ?city :inRegion ?region } LIMIT 000cities',
      ),
      people: PEOPLE(),
    });
    const bundle: ExportBundle = {
      ...base,
      groups: {
        paged: {
          nodes: { cities: { query: 'regions' }, people: { query: 'people' } },
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
      },
    };

    const { executor, seen } = recordingExecutor({
      '?city': rows('city', 'http://example.org/Perth'),
      '?name': rows('name', 'http://example.org/Ada'),
    });
    const group = fromBundle(bundle, { executor }).group('paged');
    expect(group.signature().limitParameters).toEqual(['cities']);

    await group.run({ limits: { cities: 5 } });

    expect(seen[0]).toContain('LIMIT 5');
    expect(seen[1]).not.toContain('LIMIT');
  });

  it('says so when an argument set does not name its variables', async () => {
    const group = fromBundle(await chainBundle()).group('people-by-region');
    await expect(
      group.run({ arguments: [{ arguments: { bindings: [] } } as never] }),
    ).rejects.toThrow(/declares no head.vars/);
  });

  it('reports a payload whose variables arrive in the wrong order', async () => {
    const base = await bundleOf({
      pairs: template('SELECT * { «VALUES( ?city ?year ){ ( UNDEF UNDEF ) }» ?s ?p ?o }'),
    });
    const bundle: ExportBundle = {
      ...base,
      groups: {
        single: { nodes: { only: { query: 'pairs' } }, edges: [], resultNode: 'only' },
      },
    };

    await expect(
      fromBundle(bundle)
        .group('single')
        .run({
          arguments: [
            {
              head: { vars: ['year', 'city'] },
              arguments: { bindings: [{ year: literal('2026'), city: iri('urn:perth') }] },
            },
          ],
        }),
    ).rejects.toThrow(/order mismatch/);
  });

  it('names the groups a bundle carries, and refuses one it does not', async () => {
    const library = fromBundle(await chainBundle());
    expect(library.groupNames()).toEqual(['people-by-region']);
    expect(() => library.group('nope')).toThrow(QueryCallError);
  });

  it('needs an executor, like any other call', async () => {
    await expect(
      fromBundle(await chainBundle())
        .group('people-by-region')
        .run(),
    ).rejects.toThrow(/No executor is configured/);
  });
});

describe('validating a group', () => {
  const invalid = async (group: Partial<ExportedGroup>) => {
    const bundle = await chainBundle();
    return {
      ...bundle,
      groups: { broken: { ...bundle.groups!['people-by-region'], ...group } },
    } as ExportBundle;
  };

  it('rejects a node naming a query the bundle does not carry', async () => {
    await expect(async () =>
      fromBundle(await invalid({ nodes: { cities: { query: 'missing' } }, edges: [], resultNode: 'cities' })),
    ).rejects.toThrow(InvalidBundleError);
  });

  it('rejects an edge filling a slot the target does not declare', async () => {
    await expect(async () =>
      fromBundle(
        await invalid({
          edges: [
            {
              from: 'cities',
              to: 'people',
              targetVars: ['nosuchvar'],
              mappings: [{ source: 'city', target: 'nosuchvar' }],
            },
          ],
        }),
      ),
    ).rejects.toThrow(/does not declare as a parameter slot/);
  });

  it('rejects a mapping onto a variable the edge does not carry', async () => {
    await expect(async () =>
      fromBundle(
        await invalid({
          edges: [
            {
              from: 'cities',
              to: 'people',
              targetVars: ['place'],
              mappings: [{ source: 'city', target: 'elsewhere' }],
            },
          ],
        }),
      ),
    ).rejects.toThrow(/not one of its target variables/);
  });

  it('rejects a result node that is not one of the group\'s nodes', async () => {
    await expect(async () => fromBundle(await invalid({ resultNode: 'ghost' }))).rejects.toThrow(
      /is not one of its nodes/,
    );
  });

  it('rejects a cycle', async () => {
    await expect(async () =>
      fromBundle(
        await invalid({
          edges: [
            {
              from: 'cities',
              to: 'people',
              targetVars: ['place'],
              mappings: [{ source: 'city', target: 'place' }],
            },
            {
              from: 'people',
              to: 'cities',
              targetVars: ['region'],
              mappings: [{ source: 'name', target: 'region' }],
            },
          ],
        }),
      ),
    ).rejects.toThrow(/contains a cycle/);
  });

  it('rejects chaining a query form that produces no rows', async () => {
    const base = await bundleOf({
      graph: await exportedQuery(template('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }'), {
        queryType: 'CONSTRUCT',
      }),
      people: PEOPLE(),
    });
    const bundle: ExportBundle = {
      ...base,
      groups: {
        bad: {
          nodes: { graph: { query: 'graph' }, people: { query: 'people' } },
          edges: [
            {
              from: 'graph',
              to: 'people',
              targetVars: ['place'],
              mappings: [{ source: 's', target: 'place' }],
            },
          ],
          resultNode: 'people',
        },
      },
    };

    expect(() => fromBundle(bundle)).toThrow(/chains a CONSTRUCT/);
  });
});
