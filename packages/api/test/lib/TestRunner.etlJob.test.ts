import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * An ETL job as a test subject: rows from the case's SQL fixture, triples out.
 *
 * Run for real rather than mocked, on the same reasoning as
 * `DuckDbService.sandbox.test.ts`: the claim being made is that the *whole*
 * pipeline — DuckDB, the column mapping, the SPARQL template — runs
 * hermetically when a fixture supplies the rows, and every seam a mock would
 * replace is a seam where that claim could be false. The one thing substituted
 * is the thing the runner itself substitutes: the executor, which is an
 * ephemeral Oxigraph store rather than the job version's backend.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: (id: string) => hoisted.entities.get(id) ?? null,
    list: (type: string) =>
      [...hoisted.entities.values()].filter(
        (entity) => (entity as { '@type'?: string })['@type'] === type,
      ),
  }),
}));

const { TestRunner, TestNotRunnableError } = await import('../../src/lib/TestRunner.js');

let duckdbAvailable = true;
try {
  await import('@duckdb/node-api');
} catch {
  duckdbAvailable = false;
}
const describeWithDuckDb = duckdbAvailable ? describe : describe.skip;

const JOB = 'urn:sqlib:etl-job:job1';
const JOB_VERSION = 'urn:sqlib:etl-job-version:jv1';
const MAPPING_VERSION = 'urn:sqlib:etl-column-mapping-version:m1';

function put(entity: Record<string, unknown> & { $id: string }) {
  hoisted.entities.set(entity.$id, entity);
  return entity.$id;
}

/**
 * A job that turns rows of `(id, label)` into `:person/<id> rdfs:label "…"`.
 *
 * The SQL names a relation rather than a path, which is what makes it testable
 * at all: a fixture can define `people`, and cannot shadow a `read_csv(...)`
 * call. The template is a CONSTRUCT over a placeholder `VALUES`, which is the
 * shape `applyArguments` fills — the same shape the ETL playground writes.
 */
function etlJob(fields: Record<string, unknown> = {}) {
  put({
    $id: MAPPING_VERSION,
    '@type': 'EtlColumnMappingVersion',
    isPartOf: 'urn:sqlib:etl-column-mapping:m',
    version: 1,
    columns: JSON.stringify([
      {
        columnName: 'id',
        targetVariable: 'person',
        termType: 'uri',
        iriTemplate: 'http://ex/person/{value}',
        nullPolicy: 'undef',
      },
      {
        columnName: 'label',
        targetVariable: 'label',
        termType: 'literal',
        datatypeIri: 'http://www.w3.org/2001/XMLSchema#string',
        nullPolicy: 'undef',
      },
    ]),
  });
  put({
    $id: JOB_VERSION,
    '@type': 'EtlJobVersion',
    isPartOf: JOB,
    version: 1,
    sql: 'SELECT id, label FROM people ORDER BY id',
    sparqlTemplate:
      'CONSTRUCT { ?person <http://www.w3.org/2000/01/rdf-schema#label> ?label } '
      + 'WHERE { VALUES (?person ?label) { (UNDEF UNDEF) } }',
    // Never reached: the runner hands the pipeline an ephemeral store instead.
    backendId: 'urn:sqlib:backend:live',
    currentColumnMappingVersion: MAPPING_VERSION,
    ...fields,
  });
  put({
    $id: JOB,
    '@type': 'EtlJob',
    name: 'People',
    currentVersion: JOB_VERSION,
  });
  return JOB_VERSION;
}

/** A test over the ETL job, with its cases. */
function etlTest(
  versionFields: Record<string, unknown>,
  cases: Record<string, unknown>[] = [{}],
): string {
  put({
    $id: 'urn:sqlib:test:t1',
    '@type': 'Test',
    name: 'People become labelled resources',
    subject: JOB,
    subjectKind: 'etlJob',
    isPartOf: ['urn:sqlib:library:lib'],
    currentVersion: 'urn:sqlib:test-version:tv1',
  });
  const caseIds = cases.map((testCase, index) => put({
    $id: `urn:sqlib:test-case:c${index}`,
    '@type': 'TestCase',
    isPartOf: 'urn:sqlib:test-version:tv1',
    position: index,
    ...testCase,
  }));
  return put({
    $id: 'urn:sqlib:test-version:tv1',
    '@type': 'TestVersion',
    isPartOf: 'urn:sqlib:test:t1',
    version: 1,
    cases: caseIds,
    ...versionFields,
  });
}

const PEOPLE_FIXTURE = `
  CREATE TABLE people AS
  SELECT * FROM (VALUES (1, 'Ada'), (2, 'Grace')) t(id, label);
`;

const EXPECTED = `
<http://ex/person/1> <http://www.w3.org/2000/01/rdf-schema#label> "Ada" .
<http://ex/person/2> <http://www.w3.org/2000/01/rdf-schema#label> "Grace" .
`;

beforeEach(() => {
  hoisted.entities.clear();
});

describeWithDuckDb('TestRunner — ETL job subjects', () => {
  it('runs the job over the case\'s fixture and judges the graph it constructs', async () => {
    etlJob();
    const versionId = etlTest(
      { expectationKind: 'graph' },
      [{ sqlFixture: PEOPLE_FIXTURE, expected: EXPECTED }],
    );

    const result = await new TestRunner().runTestVersion(versionId);

    expect(result.message).toBe('');
    expect(result.passed).toBe(true);
    expect(result.subjectVersionId).toBe(JOB_VERSION);
    // Nothing left the process: no backend was named and the default DuckDB
    // profile grants neither the filesystem nor HTTP.
    expect(result.hermetic).toBe(true);
  }, 30_000);

  it('fails the case when the constructed graph is not the expected one', async () => {
    etlJob();
    const versionId = etlTest(
      { expectationKind: 'graph' },
      [{
        sqlFixture: PEOPLE_FIXTURE,
        expected: '<http://ex/person/1> <http://www.w3.org/2000/01/rdf-schema#label> "Ada" .',
      }],
    );

    const result = await new TestRunner().runTestVersion(versionId);

    expect(result.passed).toBe(false);
    expect(result.cases[0].detail?.unexpected?.join('\n')).toContain('Grace');
  }, 30_000);

  it('gives each case its own database, so one fixture cannot be seen by the next', async () => {
    // The property the private instance buys. Were the fixture run on the
    // shared instance, `people` would survive the first case and the second —
    // which defines a table of its own by the same name — would fail to create
    // it, or worse, silently read the first case's rows.
    etlJob();
    const versionId = etlTest({ expectationKind: 'graph' }, [
      { sqlFixture: PEOPLE_FIXTURE, expected: EXPECTED },
      {
        sqlFixture: "CREATE TABLE people AS SELECT * FROM (VALUES (3, 'Alan')) t(id, label);",
        expected: '<http://ex/person/3> <http://www.w3.org/2000/01/rdf-schema#label> "Alan" .',
      },
    ]);

    const result = await new TestRunner().runTestVersion(versionId);

    expect(result.message).toBe('');
    expect(result.passed).toBe(true);
    expect(result.passedCount).toBe(2);
  }, 30_000);

  it('reports a fixture that does not compile as the fixture\'s failure', async () => {
    etlJob();
    const versionId = etlTest(
      { expectationKind: 'smoke' },
      [{ sqlFixture: 'CREATE TABLE people AS SELECT * FROM (' }],
    );

    const result = await new TestRunner().runTestVersion(versionId);

    expect(result.passed).toBe(false);
    // Named as the fixture rather than as the source query: they are different
    // mistakes, in different documents.
    expect(result.cases[0].message).toContain('Failed to run SQL fixture');
  }, 30_000);

  it('fails a case whose SQL reads a relation the fixture never defined', async () => {
    etlJob();
    const versionId = etlTest({ expectationKind: 'smoke' }, [{}]);

    const result = await new TestRunner().runTestVersion(versionId);

    expect(result.passed).toBe(false);
    expect(result.cases[0].message).toContain('people');
  }, 30_000);

  it('runs the template against a store seeded from the case\'s data graph', async () => {
    // A template may join against data rather than construct from its VALUES
    // alone; the case's graph is what that join sees.
    put({
      $id: 'urn:sqlib:data-graph-version:dg1',
      '@type': 'DataGraphVersion',
      isPartOf: 'urn:sqlib:data-graph:dg',
      version: 1,
      contentString: '<http://ex/person/1> <http://ex/team> <http://ex/blue> .',
      contentFormat: 'text/turtle',
      tripleCount: 1,
    });
    etlJob({
      sparqlTemplate:
        'CONSTRUCT { ?person <http://ex/team> ?team } '
        + 'WHERE { VALUES (?person ?label) { (UNDEF UNDEF) } ?person <http://ex/team> ?team }',
    });
    const versionId = etlTest(
      { expectationKind: 'graph' },
      [{
        sqlFixture: PEOPLE_FIXTURE,
        dataGraphVersion: 'urn:sqlib:data-graph-version:dg1',
        expected: '<http://ex/person/1> <http://ex/team> <http://ex/blue> .',
      }],
    );

    const result = await new TestRunner().runTestVersion(versionId);

    expect(result.message).toBe('');
    expect(result.passed).toBe(true);
  }, 30_000);
});

describe('TestRunner — ETL job expectations', () => {
  beforeEach(() => {
    hoisted.entities.clear();
  });

  it('refuses an expectation the subject cannot produce, before running anything', async () => {
    // No DuckDB is needed: the refusal is read off the version, which is the
    // point — a bindings expectation over an ETL job is a test that could never
    // pass, and saying so costs nothing to check.
    etlJob();
    const versionId = etlTest(
      { expectationKind: 'bindings' },
      [{ sqlFixture: PEOPLE_FIXTURE, expected: '{"head":{"vars":[]},"results":{"bindings":[]}}' }],
    );

    await expect(new TestRunner().runTestVersion(versionId)).rejects.toBeInstanceOf(TestNotRunnableError);
    await expect(new TestRunner().runTestVersion(versionId)).rejects.toThrow(/graph expectation/);
  });

  it('refuses an analysis expectation, which asks about an SRL document', async () => {
    etlJob();
    const versionId = etlTest(
      { expectationKind: 'analysis' },
      [{ expected: '{"check":"syntax","accepted":true}' }],
    );

    await expect(new TestRunner().runTestVersion(versionId)).rejects.toBeInstanceOf(TestNotRunnableError);
  });

  it('says which subject it could not find a version for', async () => {
    put({ $id: JOB, '@type': 'EtlJob', name: 'People' });
    const versionId = etlTest({ expectationKind: 'smoke' }, [{}]);

    // A missing subject version is "this test cannot run", not a red case: the
    // per-case catch re-raises `TestNotRunnableError` so it is reported once
    // rather than once per case.
    await expect(new TestRunner().runTestVersion(versionId))
      .rejects.toThrow(/No ETL job version to run/);
  });
});
