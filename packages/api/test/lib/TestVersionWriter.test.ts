import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * What the writer refuses, and why the entity model cannot refuse it itself.
 *
 * "A graph expectation needs an expected result" spans two fields, so it is not
 * a property of either and has no place in the schema. Left unchecked it
 * produces the worst kind of test: one that always passes and looks meaningful.
 */

const hoisted = vi.hoisted(() => ({
  entities: new Map<string, unknown>(),
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<{ type: string; id: string; updates: Record<string, unknown> }>,
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: (id: string) => hoisted.entities.get(id) ?? null,
    list: (type: string) =>
      [...hoisted.entities.values()].filter((entity) => (entity as { '@type'?: string })['@type'] === type),
    create: async (_type: string, payload: Record<string, unknown>) => {
      hoisted.created.push(payload);
      return payload;
    },
    update: async (type: string, id: string, updates: Record<string, unknown>) => {
      hoisted.updated.push({ type, id, updates });
      return { $id: id, ...updates };
    },
  }),
}));

const { createTestVersion, annotateTestVersion, TestVersionError } = await import(
  '../../src/lib/TestVersionWriter.js'
);

const TEST_ID = 'urn:sqlib:test:t1';

// Cases are written before the version that lists them, so the creates arrive
// interleaved — pick by type rather than by index.
const cases = () => hoisted.created.filter(entity => entity['@type'] === 'TestCase');
const versions = () => hoisted.created.filter(entity => entity['@type'] === 'TestVersion');
const caseDataGraphs = () => hoisted.created.filter(entity => entity['@type'] === 'TestCaseDataGraph');

beforeEach(() => {
  hoisted.entities.clear();
  hoisted.created.length = 0;
  hoisted.updated.length = 0;
  hoisted.entities.set(TEST_ID, { $id: TEST_ID, '@type': 'Test', name: 'A' });
});

describe('createTestVersion', () => {
  it('numbers versions from one and points the test at the newest', async () => {
    await createTestVersion(TEST_ID, { expectationKind: 'smoke' });
    expect(versions()[0]).toMatchObject({ version: 1, expectationKind: 'smoke' });
    expect(hoisted.updated[0]).toMatchObject({ type: 'Test', id: TEST_ID });

    hoisted.entities.set('urn:sqlib:test-version:v1', {
      $id: 'urn:sqlib:test-version:v1',
      '@type': 'TestVersion',
      isPartOf: TEST_ID,
      version: 1,
    });
    await createTestVersion(TEST_ID, { expectationKind: 'smoke' });
    expect(versions()[1]).toMatchObject({ version: 2 });
  });

  it('refuses a non-smoke expectation with nothing to compare against', async () => {
    await expect(createTestVersion(TEST_ID, { expectationKind: 'graph' }))
      .rejects.toThrow(TestVersionError);
    await expect(createTestVersion(TEST_ID, { expectationKind: 'bindings', cases: [{ expected: '   ' }] }))
      .rejects.toThrow(/needs an expected result/);
  });

  it('names the case that is wrong rather than failing the version anonymously', async () => {
    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'graph',
      cases: [{ name: 'ok', expected: '<http://ex/a> <http://ex/p> <http://ex/b> .' }, { name: 'empty' }],
    })).rejects.toThrow(/Case "empty" needs an expected result/);

    // Unnamed, so it is identified by its 1-based position — which is what the
    // case table shows.
    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'graph',
      cases: [{ expected: '<http://ex/a> <http://ex/p> <http://ex/b> .' }, {}],
    })).rejects.toThrow(/Case 2 needs an expected result/);
  });

  it('refuses an expectation kind no comparator implements', async () => {
    await expect(createTestVersion(TEST_ID, { expectationKind: 'isomorphic', cases: [{ expected: 'x' }] }))
      .rejects.toThrow(/Unknown expectation kind/);
  });

  it('refuses a boolean expectation that is not true or false', async () => {
    await expect(createTestVersion(TEST_ID, { expectationKind: 'boolean', cases: [{ expected: 'yes' }] }))
      .rejects.toThrow(/exactly "true" or "false"/);
    await expect(createTestVersion(TEST_ID, { expectationKind: 'boolean', cases: [{ expected: 'true' }] }))
      .resolves.toBeDefined();
  });

  it('refuses bindings that are not a JSON document', async () => {
    await expect(createTestVersion(TEST_ID, { expectationKind: 'bindings', cases: [{ expected: 'not json' }] }))
      .rejects.toThrow(/SPARQL JSON results document/);
  });

  it('drops an expectation sent with a smoke kind rather than storing what nothing reads', async () => {
    await createTestVersion(TEST_ID, { expectationKind: 'smoke', cases: [{ expected: 'ignored' }] });
    expect(cases()[0].expected).toBeUndefined();
  });

  /*
   * A caller that sends no cases gets one, rather than a version that runs
   * nothing. A smoke test with no inputs is a legitimate single-case test, and
   * requiring `[{}]` to say so would be ceremony.
   */
  it('writes one empty case when the caller sends none', async () => {
    await createTestVersion(TEST_ID, { expectationKind: 'smoke' });
    expect(cases()).toHaveLength(1);
    expect(cases()[0]).toMatchObject({ position: 0 });
  });

  it('carries each case its own inputs, numbered by the order they were sent', async () => {
    await createTestVersion(TEST_ID, {
      expectationKind: 'graph',
      backend: 'urn:sqlib:backend:b1',
      maxIterations: 12,
      cases: [
        {
          name: 'first',
          expected: '<http://ex/a> <http://ex/p> <http://ex/b> .',
          dataGraphVersion: 'urn:sqlib:data-graph-version:dg1',
        },
        {
          expected: '<http://ex/c> <http://ex/p> <http://ex/d> .',
          dataGraphVersion: 'urn:sqlib:data-graph-version:dg2',
        },
      ],
    });

    expect(cases()).toMatchObject([
      { position: 0, name: 'first', dataGraphVersion: 'urn:sqlib:data-graph-version:dg1' },
      { position: 1, dataGraphVersion: 'urn:sqlib:data-graph-version:dg2' },
    ]);
    // The version keeps what does not vary by case.
    expect(versions()[0]).toMatchObject({ backend: 'urn:sqlib:backend:b1', maxIterations: 12 });
    expect(versions()[0].cases).toHaveLength(2);
  });
});

describe('annotateTestVersion', () => {
  const VERSION_ID = 'urn:sqlib:test-version:v1';

  beforeEach(() => {
    hoisted.entities.set(VERSION_ID, {
      $id: VERSION_ID,
      '@type': 'TestVersion',
      isPartOf: TEST_ID,
      version: 1,
      expectationKind: 'smoke',
      immutable: true,
    });
  });

  /*
   * A version is a snapshot (issue #192). Cases refused in-place edits first —
   * they carry the expectation, so rewriting one would silently change what a
   * stored verdict was a verdict *about* — and everything else on the version
   * now follows: the subject, the backend, the limits, the expectation kind.
   * The writer takes annotations only, so there is nothing left to reject; the
   * route answers a content field with 409 before reaching here.
   */
  it('writes the comment and nothing else', async () => {
    await annotateTestVersion(VERSION_ID, { comment: 'why this exists' });
    expect(hoisted.updated.at(-1)?.updates).toEqual({ comment: 'why this exists' });
  });

  it('annotates a frozen version, which is the point of the exception', async () => {
    await expect(annotateTestVersion(VERSION_ID, { comment: 'tweak' })).resolves.toBeDefined();
  });

  it('freezes a version stored before freeze-on-create, and never the reverse', async () => {
    hoisted.entities.set(VERSION_ID, {
      $id: VERSION_ID,
      '@type': 'TestVersion',
      isPartOf: TEST_ID,
      version: 1,
      expectationKind: 'smoke',
      immutable: false,
    });

    await annotateTestVersion(VERSION_ID, { immutable: true });
    expect(hoisted.updated.at(-1)?.updates).toEqual({ immutable: true });

    hoisted.updated.length = 0;
    await annotateTestVersion(VERSION_ID, { immutable: false });
    expect(hoisted.updated).toHaveLength(0);
  });

  it('writes nothing when there is nothing to write', async () => {
    await annotateTestVersion(VERSION_ID, {});
    expect(hoisted.updated).toHaveLength(0);
  });
});

/**
 * What each subject kind will accept as input.
 *
 * These are refused at write rather than ignored at run, because the stored
 * value would not be inert: a backend on a query-group test is read by nothing
 * and yet decides what the run reports as `hermetic`, which lands in every
 * report the run emits.
 */
describe('createTestVersion — inputs a subject kind accepts', () => {
  const asKind = (subjectKind: string) => {
    hoisted.entities.set(TEST_ID, { $id: TEST_ID, '@type': 'Test', name: 'A', subjectKind });
  };

  it('refuses a backend on a rule set test, and says where to put it instead', async () => {
    asKind('ruleSet');
    await expect(createTestVersion(TEST_ID, { expectationKind: 'smoke', backend: 'urn:sqlib:backend:b' }))
      .rejects.toThrow(/query group/);
  });

  it('refuses an argument set on a rule set test', async () => {
    asKind('ruleSet');
    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{ argumentSetVersion: 'urn:sqlib:argument-set-version:a' }],
    })).rejects.toThrow(/tuple seeds, not as an argument set/);
  });

  it('accepts a data graph and tuple seeds on a rule set test', async () => {
    asKind('ruleSet');
    await createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{ dataGraphVersion: 'urn:sqlib:data-graph-version:g', tupleSeeds: 'TUPLE(:r, :a)' }],
    });
    expect(cases()).toHaveLength(1);
  });

  it('refuses a query test that names both a backend and a data graph', async () => {
    asKind('query');
    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      backend: 'urn:sqlib:backend:b',
      cases: [{ dataGraphVersion: 'urn:sqlib:data-graph-version:g' }],
    })).rejects.toThrow(/one store/);
  });

  it('refuses a query test with no store at all', async () => {
    asKind('query');
    await expect(createTestVersion(TEST_ID, { expectationKind: 'smoke' }))
      .rejects.toThrow(/nowhere to run/);
  });

  it('refuses a query test where only some cases have a data graph', async () => {
    asKind('query');
    // Half a test in an ephemeral store and half against an endpoint could not
    // say truthfully which kind of run it was.
    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{ dataGraphVersion: 'urn:sqlib:data-graph-version:g' }, {}],
    })).rejects.toThrow(/Every case needs a data graph/);
  });

  it('accepts a query test on a backend, and one on data graphs throughout', async () => {
    asKind('query');
    await createTestVersion(TEST_ID, { expectationKind: 'smoke', backend: 'urn:sqlib:backend:b' });
    expect(versions()).toHaveLength(1);

    hoisted.created.length = 0;
    await createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [
        { dataGraphVersion: 'urn:sqlib:data-graph-version:g1' },
        { dataGraphVersion: 'urn:sqlib:data-graph-version:g2' },
      ],
    });
    expect(cases()).toHaveLength(2);
  });

  it('refuses a backend or tuple seeds on a query group test', async () => {
    asKind('queryGroup');
    await expect(createTestVersion(TEST_ID, { expectationKind: 'smoke', backend: 'urn:sqlib:backend:b' }))
      .rejects.toThrow(/nodes name their own backends/);

    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{ tupleSeeds: 'TUPLE(?x) { (1) }' }],
    })).rejects.toThrow(/tuple seeds are a rule set's input/);
  });

  it('accepts an argument set on a query group test — the start node interface', async () => {
    asKind('queryGroup');
    await createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{ argumentSetVersion: 'urn:sqlib:argument-set-version:a' }],
    });
    expect(cases()).toHaveLength(1);
  });

  it('accepts a data graph beside an argument set on a query group test', async () => {
    // A start node declares tuple inputs and data graph inputs independently,
    // so filling both is one case with two inputs, not a contradiction. The
    // query kind's exclusive-store rule does not reach here: a group names its
    // stores per node, and the graph is data going in.
    asKind('queryGroup');
    await createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{
        argumentSetVersion: 'urn:sqlib:argument-set-version:a',
        dataGraphVersion: 'urn:sqlib:data-graph-version:g',
      }],
    });
    expect(cases()).toHaveLength(1);
  });

  it('accepts a SQL fixture on an ETL job test, and a data graph beside it', async () => {
    // The rows the job's SQL reads, plus the store its template runs against.
    // Independent slots, like a group's arguments and graphs, rather than a
    // choice: a template may construct from its VALUES and join against data.
    asKind('etlJob');
    await createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{
        sqlFixture: 'CREATE TABLE t AS SELECT 1 AS id',
        dataGraphVersion: 'urn:sqlib:data-graph-version:g',
      }],
    });
    expect(cases()).toHaveLength(1);
  });

  it('refuses a backend, an argument set or tuple seeds on an ETL job test', async () => {
    asKind('etlJob');
    await expect(createTestVersion(TEST_ID, { expectationKind: 'smoke', backend: 'urn:sqlib:backend:b' }))
      .rejects.toThrow(/never runs against it/);

    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{ argumentSetVersion: 'urn:sqlib:argument-set-version:a' }],
    })).rejects.toThrow(/declares no parameters/);

    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{ tupleSeeds: 'TUPLE(?x) { (1) }' }],
    })).rejects.toThrow(/an ETL job takes a SQL fixture/);
  });

  it('refuses a SQL fixture on every kind that reads no rows of its own', async () => {
    for (const kind of ['ruleSet', 'query', 'queryGroup']) {
      asKind(kind);
      await expect(createTestVersion(TEST_ID, {
        expectationKind: 'smoke',
        // A backend so the query kind's exclusive-store rule is satisfied and
        // the fixture is the only thing left to refuse.
        backend: kind === 'query' ? 'urn:sqlib:backend:b' : null,
        cases: [{ sqlFixture: 'CREATE TABLE t AS SELECT 1 AS id' }],
      }), kind).rejects.toThrow(/a SQL fixture supplies the rows an ETL job reads/);
    }
  });

  it('names the offending case the way the author named it', async () => {
    asKind('queryGroup');
    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{}, { name: 'with a cycle', tupleSeeds: 'TUPLE(?x) { (1) }' }],
    })).rejects.toThrow(/Case "with a cycle"/);
  });

  it('writes no cases when the inputs are refused', async () => {
    asKind('queryGroup');
    // `writeCases` creates as it goes, so a refusal that ran after it would
    // leave children behind for a version that was never written.
    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{ tupleSeeds: 'TUPLE(?x) { (1) }' }],
    })).rejects.toThrow();
    expect(hoisted.created).toHaveLength(0);
  });

  it('passes over a test whose subject kind predates the check', async () => {
    // No subjectKind at all: the create route validates it, so an unreadable
    // one means an older entity, and failing its every future version would be
    // worse than skipping one rule.
    hoisted.entities.set(TEST_ID, { $id: TEST_ID, '@type': 'Test', name: 'A' });
    await createTestVersion(TEST_ID, { expectationKind: 'smoke', backend: 'urn:sqlib:backend:b' });
    expect(versions()).toHaveLength(1);
  });
});

/*
 * Issue #298. A case could name one `dataGraphVersion`, so a query group with
 * several RDF inputs could not be covered by a Test at all — the run failed
 * with "the query group's start node declares data graph input …, which this
 * run did not supply".
 */
describe('a case with several data graphs', () => {
  it('writes one ordered child per graph and lists them on the case', async () => {
    await createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{
        dataGraphs: [
          { dataGraphVersion: 'urn:sqlib:data-graph-version:shapes' },
          { dataGraphVersion: 'urn:sqlib:data-graph-version:data' },
        ],
      }],
    });

    const graphs = caseDataGraphs();
    expect(graphs).toHaveLength(2);
    // Position is assigned from the order sent, not accepted, so two graphs
    // cannot claim the same slot — and the slot is what decides which of the
    // group's declared inputs each one fills.
    expect(graphs.map(entry => entry.position)).toEqual([0, 1]);
    expect(graphs.map(entry => entry.dataGraphVersion)).toEqual([
      'urn:sqlib:data-graph-version:shapes',
      'urn:sqlib:data-graph-version:data',
    ]);
    expect(graphs.every(entry => entry.isPartOf === cases()[0]!.$id)).toBe(true);
    expect(cases()[0]!.dataGraphs).toEqual(graphs.map(entry => entry.$id));
  });

  it('leaves a single-graph case exactly as it was', async () => {
    await createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{ dataGraphVersion: 'urn:sqlib:data-graph-version:only' }],
    });

    expect(caseDataGraphs()).toHaveLength(0);
    expect(cases()[0]!.dataGraphVersion).toBe('urn:sqlib:data-graph-version:only');
    expect(cases()[0]!.dataGraphs).toBeUndefined();
  });

  /*
   * Refused rather than merged: a merge has to pick an order for the lone
   * graph, and any pick would be the writer inventing a fact the caller did
   * not state.
   */
  it('refuses a case that sets both spellings', async () => {
    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{
        dataGraphVersion: 'urn:sqlib:data-graph-version:only',
        dataGraphs: [{ dataGraphVersion: 'urn:sqlib:data-graph-version:shapes' }],
      }],
    })).rejects.toThrow(TestVersionError);
  });

  it('refuses a graph entry with no version', async () => {
    await expect(createTestVersion(TEST_ID, {
      expectationKind: 'smoke',
      cases: [{ dataGraphs: [{ dataGraphVersion: '  ' }] }],
    })).rejects.toThrow(/needs a dataGraphVersion/);
  });
});

/**
 * A group case's graphs sit after its argument set's, not against them.
 *
 * The writer used to refuse a case that supplied a graph for a port its pinned
 * set already filled. There is no such collision now that the pairing lives on
 * the group: a set fills slots 0..n-1 and `TestRunner` appends the case's
 * graphs after them, so a case graph never lands on a slot the set occupies.
 * Whether the total matches the ports the start node declares is the run's
 * question — only it has the group — and the engine answers it in both
 * directions.
 */
describe('createTestVersion — a group case that supplies graphs beside its argument set', () => {
  const GROUP_TEST = 'urn:sqlib:test:group';
  const SET_VERSION = 'urn:sqlib:argument-set-version:v1';
  const GRAPH_VERSION = 'urn:sqlib:data-graph-version:v1';

  function seedSetWithGraphs(count: number) {
    const bindings = Array.from({ length: count }, (_, index) => {
      const bindingId = `urn:sqlib:argument-graph-binding:b${index}`;
      hoisted.entities.set(bindingId, { $id: bindingId, '@type': 'ArgumentGraphBinding', position: index });
      return bindingId;
    });
    hoisted.entities.set(SET_VERSION, {
      $id: SET_VERSION, '@type': 'ArgumentSetVersion', version: 1, graphBindings: bindings,
    });
  }

  beforeEach(() => {
    hoisted.entities.set(GROUP_TEST, {
      $id: GROUP_TEST, '@type': 'Test', name: 'Group test', subjectKind: 'queryGroup',
    });
  });

  it('accepts a case graph beside a set that already carries one', async () => {
    seedSetWithGraphs(1);
    await expect(createTestVersion(GROUP_TEST, {
      expectationKind: 'bindings',
      cases: [{
        expected: '{}',
        argumentSetVersion: SET_VERSION,
        dataGraphs: [{ dataGraphVersion: GRAPH_VERSION }],
      }],
    })).resolves.toBeDefined();
  });

  it('reads the one-graph spelling the same way', async () => {
    seedSetWithGraphs(1);
    await expect(createTestVersion(GROUP_TEST, {
      expectationKind: 'bindings',
      cases: [{
        expected: '{}',
        argumentSetVersion: SET_VERSION,
        dataGraphVersion: GRAPH_VERSION,
      }],
    })).resolves.toBeDefined();
  });

  it('leaves a case alone when its set carries no graphs', async () => {
    seedSetWithGraphs(0);
    await expect(createTestVersion(GROUP_TEST, {
      expectationKind: 'bindings',
      cases: [{
        expected: '{}',
        argumentSetVersion: SET_VERSION,
        dataGraphs: [{ dataGraphVersion: GRAPH_VERSION }],
      }],
    })).resolves.toBeDefined();
  });
});
