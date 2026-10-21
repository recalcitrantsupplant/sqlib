import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { fromBundle, iri, verifyBundleIntegrity } from '@sparql-query-lib/runtime';
import libraryRoutes from '../../src/routes/libraries.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const LIBRARY = 'urn:sqlib:library:main';

const {
  library,
  query,
  queryVersion,
  queryGroup,
  queryGroupVersion,
  test: testRepo,
  testVersion,
  testCase,
  etlJob,
  etlJobVersion,
  etlColumnMappingVersion,
  ruleSet,
  ruleSetVersion,
  ruleVersion,
  dataBlockVersion,
  entities,
  exportRuntimePayload,
} = vi.hoisted(() => {
  const make = () => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() });
  return {
    library: make(),
    query: make(),
    queryVersion: make(),
    queryGroup: make(),
    queryGroupVersion: make(),
    test: make(),
    testVersion: make(),
    testCase: make(),
    etlJob: make(),
    etlJobVersion: make(),
    etlColumnMappingVersion: make(),
    ruleSet: make(),
    ruleSetVersion: make(),
    ruleVersion: make(),
    dataBlockVersion: make(),
    /** A group's graph, read through the coordinator the way the engine reads it. */
    entities: new Map<string, Record<string, unknown>>(),
    exportRuntimePayload: vi.fn(),
  };
});

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    Library: library,
    Query: query,
    QueryVersion: queryVersion,
    QueryGroup: queryGroup,
    QueryGroupVersion: queryGroupVersion,
    Test: testRepo,
    TestVersion: testVersion,
    TestCase: testCase,
    EtlJob: etlJob,
    EtlJobVersion: etlJobVersion,
    EtlColumnMappingVersion: etlColumnMappingVersion,
    RuleSet: ruleSet,
    RuleSetVersion: ruleSetVersion,
    RuleVersion: ruleVersion,
    DataBlockVersion: dataBlockVersion,
  }),
  getCacheCoordinator: () => ({ get: (id: string) => entities.get(id) ?? null }),
}));

vi.mock('../../src/lib/ArgumentSetService.js', () => ({
  ArgumentSetService: vi.fn(function () {
    return { exportRuntimePayload };
  }),
}));

vi.mock('../../src/lib/system-queries/SystemQueryRunner.js', () => ({
  SystemQueryRunner: vi.fn(function () {
    return { execute: vi.fn() };
  }),
}));

const PEOPLE_QUERY = `
PREFIX ex: <http://example.org/>
SELECT ?name WHERE {
  VALUES (?city) { (UNDEF) }
  ?person ex:livesIn ?city ; ex:name ?name .
}`;

function seedLibrary(
  queries: Array<{ id: string; name: string; currentVersion?: string; tags?: string[] }>,
  versions: Record<string, string>,
) {
  library.get.mockImplementation((id: string) =>
    id === LIBRARY ? { $id: LIBRARY, name: 'Main' } : null,
  );
  query.list.mockReturnValue(
    queries.map((q) => ({
      $id: q.id,
      name: q.name,
      isPartOf: [LIBRARY],
      ...(q.currentVersion ? { currentVersion: q.currentVersion } : {}),
      ...(q.tags ? { tags: q.tags } : {}),
    })),
  );
  queryVersion.get.mockImplementation((id: string) =>
    versions[id] ? { $id: id, isPartOf: 'q', version: 1, queryString: versions[id] } : null,
  );
  // Most cases have no tests; the ones that do call seedTests() after this.
  testRepo.list.mockReturnValue([]);
  // Likewise groups: seedGroup() fills these in for the cases that need them.
  queryGroup.list.mockReturnValue([]);
  queryGroupVersion.get.mockReturnValue(null);
  // And ETL jobs and rule sets: seedJobsAndRuleSets().
  etlJob.list.mockReturnValue([]);
  ruleSet.list.mockReturnValue([]);
  entities.clear();
}

const JOB_TEMPLATE = `PREFIX ex: <http://ex/>
CONSTRUCT { ?c ex:name ?name } WHERE { VALUES (?c ?name) { (UNDEF UNDEF) } }`;

const COLUMNS = [
  { columnName: 'id', targetVariable: 'c', termType: 'uri', iriTemplate: 'http://ex/c/{value}', nullPolicy: 'skipRow' },
  { columnName: 'name', targetVariable: 'name', termType: 'literal', nullPolicy: 'undef' },
];

/** One ETL job and one rule set with a rule and a data block. */
function seedJobsAndRuleSets(options: { template?: string } = {}) {
  etlJob.list.mockReturnValue([
    { $id: 'j1', name: 'Customers', isPartOf: [LIBRARY], currentVersion: 'jv1' },
  ]);
  etlJobVersion.get.mockImplementation((id: string) =>
    id === 'jv1'
      ? {
          $id: 'jv1',
          isPartOf: 'j1',
          version: 1,
          sql: "SELECT * FROM read_csv('customers.csv')",
          sparqlTemplate: options.template ?? JOB_TEMPLATE,
          backendId: 'urn:backend:x',
          currentColumnMappingVersion: 'cmv1',
          chunkSize: 500,
        }
      : null,
  );
  etlColumnMappingVersion.get.mockImplementation((id: string) =>
    id === 'cmv1' ? { $id: 'cmv1', isPartOf: 'cm1', version: 1, columns: JSON.stringify(COLUMNS) } : null,
  );
  ruleSet.list.mockReturnValue([
    { $id: 'rs1', name: 'Ancestors', isPartOf: [LIBRARY], currentVersion: 'rsv1', tags: ['urn:tag:public'] },
  ]);
  ruleSetVersion.get.mockImplementation((id: string) =>
    id === 'rsv1' ? { $id: 'rsv1', isPartOf: 'rs1', version: 1, hasRule: ['rv1'], hasDataBlock: ['dbv1'] } : null,
  );
  ruleVersion.get.mockImplementation((id: string) =>
    id === 'rv1'
      ? { $id: 'rv1', isPartOf: 'r1', ruleString: 'RULE { ?x <http://ex/anc> ?y } WHERE { ?x <http://ex/parent> ?y }' }
      : null,
  );
  dataBlockVersion.get.mockImplementation((id: string) =>
    id === 'dbv1'
      ? { $id: 'dbv1', isPartOf: 'db1', dataString: 'INSERT DATA { <http://ex/a> <http://ex/parent> <http://ex/b> }' }
      : null,
  );
}

const CITIES_QUERY = `
PREFIX ex: <http://example.org/>
SELECT ?city WHERE {
  VALUES (?region) { (UNDEF) }
  ?city ex:inRegion ?region .
}`;

const PLACES_QUERY = `
PREFIX ex: <http://example.org/>
SELECT ?name WHERE {
  VALUES (?place) { (UNDEF) }
  ?person ex:livesIn ?place ; ex:name ?name .
}`;

/**
 * One two-node group: cities in a region, then the people in those cities.
 *
 * Written out as the entities a store actually holds — nodes, edges, tuples,
 * members and variables — because that graph is what the export walks.
 */
function seedGroup(overrides: Record<string, Record<string, unknown>> = {}) {
  queryGroup.list.mockReturnValue([
    { $id: 'g1', name: 'People by region', isPartOf: LIBRARY, currentVersion: 'gv1' },
  ]);
  queryGroupVersion.get.mockImplementation((id: string) =>
    id === 'gv1'
      ? {
          $id: 'gv1',
          isPartOf: 'g1',
          version: 1,
          startNode: 'start',
          endNode: 'end',
          executionNodes: ['n1', 'n2'],
          edges: ['e1', 'e2'],
        }
      : null,
  );

  const tuple = (id: string, type: string, name: string) => {
    entities.set(id, { '@type': type, memberEntries: [`${id}-m`] });
    entities.set(`${id}-m`, { '@type': 'TupleMember', position: 0, variable: `${id}-v` });
    entities.set(`${id}-v`, {
      '@type': type === 'QueryOutputTuple' ? 'QueryOutputVariable' : 'QueryInputVariable',
      variableName: name,
    });
  };

  entities.set('start', { '@type': 'StartNode' });
  entities.set('end', { '@type': 'EndNode' });
  entities.set('n1', { '@type': 'QueryNode', queryId: 'gqv1' });
  entities.set('n2', { '@type': 'QueryNode', queryId: 'gqv2' });
  entities.set('gqv1', {
    '@type': 'QueryVersion',
    $id: 'gqv1',
    isPartOf: 'gq1',
    version: 1,
    queryString: CITIES_QUERY,
  });
  entities.set('gqv2', {
    '@type': 'QueryVersion',
    $id: 'gqv2',
    isPartOf: 'gq2',
    version: 1,
    queryString: PLACES_QUERY,
  });
  entities.set('gq1', { '@type': 'Query', $id: 'gq1', name: 'Cities in region' });
  entities.set('gq2', { '@type': 'Query', $id: 'gq2', name: 'People in place' });
  tuple('in-region', 'QueryInputTuple', 'region');
  tuple('in-place', 'QueryInputTuple', 'place');
  tuple('out-city', 'QueryOutputTuple', 'city');
  tuple('out-name', 'QueryOutputTuple', 'name');
  entities.set('e1', {
    '@type': 'QueryEdge',
    sourceNodeId: 'n1',
    targetNodeId: 'n2',
    dataFlowType: 'VARIABLE_BINDINGS',
    sourceOutputId: 'out-city',
    targetInputId: 'in-place',
  });
  entities.set('e2', {
    '@type': 'QueryEdge',
    sourceNodeId: 'n2',
    targetNodeId: 'end',
    dataFlowType: 'VARIABLE_BINDINGS',
    sourceOutputId: 'out-name',
    targetInputId: 'out-name',
  });

  for (const [id, entity] of Object.entries(overrides)) entities.set(id, entity);
}

/** One test, one case, against the query with the given IRI. */
function seedTests(subject: string, overrides: Record<string, unknown> = {}) {
  testRepo.list.mockReturnValue([
    {
      $id: 't1',
      name: 'People by city',
      subject,
      subjectKind: 'query',
      isPartOf: [LIBRARY],
      currentVersion: 'tv1',
    },
  ]);
  testVersion.get.mockImplementation((id: string) =>
    id === 'tv1'
      ? { $id: 'tv1', isPartOf: 't1', version: 1, expectationKind: 'bindings', cases: ['tc1'] }
      : null,
  );
  testCase.get.mockImplementation((id: string) =>
    id === 'tc1'
      ? {
          $id: 'tc1',
          isPartOf: 'tv1',
          position: 0,
          name: 'Perth',
          argumentSetVersion: 'asv1',
          expected: '{"head":{"vars":["name"]}}',
          expectedFormat: 'application/sparql-results+json',
          ...overrides,
        }
      : null,
  );
  exportRuntimePayload.mockResolvedValue({
    tupleList: [
      {
        head: { vars: ['city'] },
        results: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }] },
      },
    ],
    limits: [],
    offsets: [],
  });
}

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
  }
  await app.register(libraryRoutes, { prefix: '/libraries' });
  await app.ready();
  return app;
}

describe('GET /libraries/:id/export-bundle', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns a bundle the runtime can execute without a server', async () => {
    seedLibrary([{ id: 'q1', name: 'People by city', currentVersion: 'v1' }], { v1: PEOPLE_QUERY });

    const response = await app.inject({ url: `/libraries/${LIBRARY}/export-bundle` });
    expect(response.statusCode).toBe(200);

    const { bundle, skipped } = response.json();
    expect(skipped).toEqual([]);
    await verifyBundleIntegrity(bundle);

    // The point of the route: what came back over HTTP runs on its own. The IRI
    // comes out abbreviated because the bundle carries the query's prefix table,
    // which is what keeps its output identical to the server's.
    const text = fromBundle(bundle)
      .query('people-by-city')
      .text({ arguments: [{ bindings: [{ city: iri('http://example.org/Perth') }] }] });
    expect(text).toContain('VALUES ?city { ex:Perth }');
  });

  it('404s for a library that does not exist', async () => {
    library.get.mockReturnValue(null);
    const response = await app.inject({ url: '/libraries/urn:sqlib:library:nope/export-bundle' });
    expect(response.statusCode).toBe(404);
  });

  it('filters by tag', async () => {
    seedLibrary(
      [
        { id: 'q1', name: 'Public', currentVersion: 'v1', tags: ['urn:tag:public'] },
        { id: 'q2', name: 'Private', currentVersion: 'v1' },
      ],
      { v1: PEOPLE_QUERY },
    );

    const response = await app.inject({
      url: `/libraries/${LIBRARY}/export-bundle`,
      query: { tag: 'urn:tag:public' },
    });

    const { bundle } = response.json();
    expect(Object.keys(bundle.queries)).toEqual(['public']);
    expect(bundle.tags).toEqual(['urn:tag:public']);
  });

  it('reports a query it could not include instead of dropping it', async () => {
    seedLibrary(
      [
        { id: 'q1', name: 'Ready', currentVersion: 'v1' },
        { id: 'q2', name: 'Draft' },
      ],
      { v1: PEOPLE_QUERY },
    );

    const { bundle, skipped } = (await app.inject({ url: `/libraries/${LIBRARY}/export-bundle` })).json();
    expect(Object.keys(bundle.queries)).toEqual(['ready']);
    expect(skipped).toEqual([
      { id: 'q2', name: 'Draft', reason: 'The query has no current version.' },
    ]);
  });

  it('answers 400, not 500, when a query cannot be exported', async () => {
    seedLibrary([{ id: 'q1', name: 'Wipe', currentVersion: 'v1' }], {
      v1: 'DELETE WHERE { ?s ?p ?o }',
    });

    const response = await app.inject({ url: `/libraries/${LIBRARY}/export-bundle` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/update operation/);
  });

  describe('query groups', () => {
    it('exports a chained group beside the queries it runs', async () => {
      seedLibrary([{ id: 'q1', name: 'People by city', currentVersion: 'v1' }], {
        v1: PEOPLE_QUERY,
      });
      seedGroup();

      const { bundle, skipped } = (
        await app.inject({ url: `/libraries/${LIBRARY}/export-bundle` })
      ).json();

      expect(skipped).toEqual([]);
      await verifyBundleIntegrity(bundle);

      const group = bundle.groups['people-by-region'];
      expect(group.resultNode).toBe('people-in-place');
      expect(group.edges).toEqual([
        {
          from: 'cities-in-region',
          to: 'people-in-place',
          targetVars: ['place'],
          mappings: [{ source: 'city', target: 'place' }],
          sourceEdge: 'e1',
        },
      ]);
      // The nodes' queries came along, since the library publishes neither of
      // the versions the group pins.
      expect(Object.keys(bundle.queries).sort()).toEqual([
        'cities-in-region',
        'people-by-city',
        'people-in-place',
      ]);

      // And the walk substitutes: the second hop's slot is filled by the first
      // hop's rows, without a server anywhere.
      const library = fromBundle(bundle, {
        executor: {
          execute: async ({ queryText }) =>
            queryText.includes('?city')
              ? {
                  head: { vars: ['city'] },
                  results: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }] },
                }
              : { head: { vars: ['name'] }, results: { bindings: [] } },
        },
      });
      const detailed = await library.group('people-by-region').runDetailed({
        arguments: [
          {
            head: { vars: ['region'] },
            results: { bindings: [{ region: iri('http://example.org/WA') }] },
          },
        ],
      });
      expect(detailed.texts['people-in-place']).toContain('VALUES ?place { ex:Perth }');
    });

    it('reports a group it could not carry, and still exports the queries', async () => {
      seedLibrary([{ id: 'q1', name: 'People by city', currentVersion: 'v1' }], {
        v1: PEOPLE_QUERY,
      });
      seedGroup({ n2: { '@type': 'RuleSetNode', ruleSetVersion: 'rv1' } });

      const { bundle, skipped } = (
        await app.inject({ url: `/libraries/${LIBRARY}/export-bundle` })
      ).json();

      expect(bundle.groups).toBeUndefined();
      expect(Object.keys(bundle.queries)).toEqual(['people-by-city']);
      expect(skipped).toEqual([
        {
          id: 'g1',
          name: 'People by region',
          reason:
            'Node n2 is a RuleSetNode. The static runtime runs SPARQL queries only, so a group containing one cannot be exported.',
        },
      ]);
    });
  });

  describe('ETL jobs and rule sets', () => {
    it('carries both, in a bundle that validates and verifies', async () => {
      seedLibrary([{ id: 'q1', name: 'People by city', currentVersion: 'v1' }], { v1: PEOPLE_QUERY });
      seedJobsAndRuleSets();

      const response = await app.inject({ url: `/libraries/${LIBRARY}/export-bundle` });
      expect(response.statusCode).toBe(200);
      const { bundle, skipped } = response.json();
      expect(skipped).toEqual([]);
      await verifyBundleIntegrity(bundle);
      fromBundle(bundle);

      const job = bundle.etlJobs.customers;
      expect(job.template.slots).toHaveLength(1);
      expect(job.template.slots[0].vars).toEqual(['c', 'name']);
      expect(job.columns).toEqual(COLUMNS);
      expect(job).toMatchObject({ chunkSize: 500, sourceJob: 'j1', sourceVersion: 'jv1', sourceColumnMappingVersion: 'cmv1' });
      // The job's backend names a server's backend; it stays behind.
      expect(JSON.stringify(job)).not.toContain('urn:backend:x');

      const rules = bundle.ruleSets.ancestors;
      expect(rules).toMatchObject({ ruleCount: 1, dataBlockCount: 1, sourceRuleSet: 'rs1', sourceVersion: 'rsv1' });
      expect(rules.srl).toContain('RULE');
      expect(rules.srl).toContain('DATA');
    });

    it('skips a job whose template is not a CONSTRUCT, and says why', async () => {
      seedLibrary([], {});
      seedJobsAndRuleSets({ template: 'SELECT ?c WHERE { VALUES ?c { UNDEF } }' });

      const { bundle, skipped } = (await app.inject({ url: `/libraries/${LIBRARY}/export-bundle` })).json();
      expect(bundle.etlJobs).toBeUndefined();
      expect(skipped).toEqual([{ id: 'j1', name: 'Customers', reason: expect.stringContaining('not a CONSTRUCT') }]);
    });

    it('skips a rule set whose data block has no DATA form', async () => {
      seedLibrary([], {});
      seedJobsAndRuleSets();
      dataBlockVersion.get.mockReturnValue({ $id: 'dbv1', dataString: 'DELETE WHERE { ?s ?p ?o }' });

      const { bundle, skipped } = (await app.inject({ url: `/libraries/${LIBRARY}/export-bundle` })).json();
      expect(bundle.ruleSets).toBeUndefined();
      expect(skipped).toEqual([{ id: 'rs1', name: 'Ancestors', reason: expect.stringContaining('not expressible') }]);
    });

    it('leaves them out on etl=false and ruleSets=false', async () => {
      seedLibrary([], {});
      seedJobsAndRuleSets();

      const { bundle } = (
        await app.inject({ url: `/libraries/${LIBRARY}/export-bundle?etl=false&ruleSets=false` })
      ).json();
      expect(bundle.etlJobs).toBeUndefined();
      expect(bundle.ruleSets).toBeUndefined();
    });

    it('applies a tag filter: jobs carry no tags, so none match', async () => {
      seedLibrary([], {});
      seedJobsAndRuleSets();

      const { bundle } = (
        await app.inject({ url: `/libraries/${LIBRARY}/export-bundle?tag=urn:tag:public` })
      ).json();
      expect(bundle.etlJobs).toBeUndefined();
      expect(Object.keys(bundle.ruleSets)).toEqual(['ancestors']);
    });
  });

  it('rejects an unknown query parameter rather than ignoring it', async () => {
    seedLibrary([], {});
    const response = await app.inject({
      url: `/libraries/${LIBRARY}/export-bundle`,
      query: { tags: 'urn:tag:typo' },
    });
    expect(response.statusCode).toBe(400);
  });

  describe('examples drawn from the library tests', () => {
    beforeEach(() => {
      seedLibrary([{ id: 'q1', name: 'People by city', currentVersion: 'v1' }], { v1: PEOPLE_QUERY });
      seedTests('q1');
    });

    it('attaches them by default, as a payload the runtime can run', async () => {
      const { bundle } = (await app.inject({ url: `/libraries/${LIBRARY}/export-bundle` })).json();
      const example = bundle.queries['people-by-city'].examples[0];

      expect(example.name).toBe('Perth');
      // The example is not merely stored — it substitutes.
      const text = fromBundle(bundle)
        .query('people-by-city')
        .text({ arguments: example.arguments });
      expect(text).toContain('VALUES ?city { ex:Perth }');
    });

    it('drops the recorded result unless asked', async () => {
      const { bundle } = (await app.inject({ url: `/libraries/${LIBRARY}/export-bundle` })).json();
      expect(bundle.queries['people-by-city'].examples[0].expected).toBeUndefined();
    });

    it('carries the recorded result when asked', async () => {
      const { bundle } = (
        await app.inject({ url: `/libraries/${LIBRARY}/export-bundle`, query: { expected: 'true' } })
      ).json();
      expect(bundle.queries['people-by-city'].examples[0].expected).toBe('{"head":{"vars":["name"]}}');
    });

    it('takes none when asked, without resolving any arguments', async () => {
      const { bundle } = (
        await app.inject({ url: `/libraries/${LIBRARY}/export-bundle`, query: { examples: 'none' } })
      ).json();
      expect(bundle.queries['people-by-city'].examples).toBeUndefined();
      expect(exportRuntimePayload).not.toHaveBeenCalled();
    });

    it('reports a test it could not turn into an example', async () => {
      seedTests('q1', { argumentSetVersion: undefined });
      const { skipped } = (await app.inject({ url: `/libraries/${LIBRARY}/export-bundle` })).json();
      expect(skipped[0].reason).toMatch(/supplies no arguments/);
    });

    it('rejects an unknown examples mode', async () => {
      const response = await app.inject({
        url: `/libraries/${LIBRARY}/export-bundle`,
        query: { examples: 'some' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('format=html', () => {
    beforeEach(() => {
      seedLibrary([{ id: 'q1', name: 'People by city', currentVersion: 'v1' }], { v1: PEOPLE_QUERY });
      seedTests('q1');
    });

    it('returns a self-contained page carrying the runtime and the bundle', async () => {
      const response = await app.inject({
        url: `/libraries/${LIBRARY}/export-bundle`,
        query: { format: 'html' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.body).toContain('window.SQLIB_BUNDLE');
      expect(response.body).toContain('applyTemplateArguments');
      expect(response.body).toContain('people-by-city');
      // The example became a button on the page.
      expect(response.body).toContain('data-example-for="people-by-city"');
    });

    it('shows what the export left out', async () => {
      seedLibrary(
        [
          { id: 'q1', name: 'People by city', currentVersion: 'v1' },
          { id: 'q2', name: 'Draft' },
        ],
        { v1: PEOPLE_QUERY },
      );
      seedTests('q1');

      const response = await app.inject({
        url: `/libraries/${LIBRARY}/export-bundle`,
        query: { format: 'html' },
      });
      expect(response.body).toContain('not in this export');
      expect(response.body).toContain('Draft');
    });
  });

  describe('format=ipynb', () => {
    beforeEach(() => {
      seedLibrary([{ id: 'q1', name: 'People by city', currentVersion: 'v1' }], { v1: PEOPLE_QUERY });
      seedTests('q1');
    });

    it('returns a Jupyter notebook of worked calls', async () => {
      const response = await app.inject({
        url: `/libraries/${LIBRARY}/export-bundle`,
        query: { format: 'ipynb' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/x-ipynb\+json/);
      const notebook = response.json();
      expect(notebook.nbformat).toBe(4);
      const code = notebook.cells.find(
        (c: { cell_type: string; source: string }) => c.cell_type === 'code' && c.source.includes('QUERY ='),
      );
      expect(code.source).toContain('def run(');
      const markdown = notebook.cells.find((c: { source: string }) => c.source.includes('people-by-city'));
      expect(markdown).toBeDefined();
    });

    it('shows what the export left out', async () => {
      seedLibrary(
        [
          { id: 'q1', name: 'People by city', currentVersion: 'v1' },
          { id: 'q2', name: 'Draft' },
        ],
        { v1: PEOPLE_QUERY },
      );
      seedTests('q1');

      const response = await app.inject({
        url: `/libraries/${LIBRARY}/export-bundle`,
        query: { format: 'ipynb' },
      });
      const notebook = response.json();
      const callout = notebook.cells.find((c: { source: string }) => c.source.includes('not in this export'));
      expect(callout.source).toContain('Draft');
    });
  });
});
