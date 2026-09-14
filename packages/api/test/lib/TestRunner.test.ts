import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The runner's job, end to end, for the one subject kind that runs entirely
 * in-process: a rule set against a data graph.
 *
 * That combination is the hermetic case the design is built around — no
 * backend, no network, deterministic — so it is the one that can be asserted
 * without mocking away the thing under test. Query and group subjects reach a
 * live executor; their invocation paths are shared with the benchmark runner
 * and covered there.
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

const PREFIX = 'PREFIX : <http://ex/>';

function put(entity: Record<string, unknown> & { $id: string }) {
  hoisted.entities.set(entity.$id, entity);
  return entity.$id;
}

/** A rule set that derives `:reaches` from `:edge`, and nothing else. */
function reachabilityRuleSet(): string {
  const ruleId = put({
    $id: 'urn:test:rule-version:reach',
    '@type': 'RuleVersion',
    isPartOf: 'urn:test:rule:reach',
    version: 1,
    ruleString: `${PREFIX}\nRULE { ?x :reaches ?y } WHERE { ?x :edge ?y }`,
    grammarValid: true,
  });
  const versionId = put({
    $id: 'urn:test:rule-set-version:1',
    '@type': 'RuleSetVersion',
    isPartOf: 'urn:sqlib:ruleset:rs1',
    version: 1,
    hasRule: [ruleId],
    hasDataBlock: [],
  });
  put({
    $id: 'urn:sqlib:ruleset:rs1',
    '@type': 'RuleSet',
    name: 'Reachability',
    currentVersion: versionId,
  });
  return versionId;
}

function dataGraph(content: string, format = 'text/turtle', suffix = 'dg1'): string {
  return put({
    $id: `urn:sqlib:data-graph-version:${suffix}`,
    '@type': 'DataGraphVersion',
    isPartOf: 'urn:sqlib:data-graph:dg',
    version: 1,
    contentString: content,
    contentFormat: format,
    tripleCount: 1,
  });
}

/**
 * A test with its cases. Defaults to one empty case, which is the ordinary
 * single test — the shape everything but the parametrise tests below wants.
 */
function test(
  versionFields: Record<string, unknown>,
  cases: Record<string, unknown>[] = [{}],
): string {
  put({
    $id: 'urn:sqlib:test:t1',
    '@type': 'Test',
    name: 'Reaches b',
    subject: 'urn:sqlib:ruleset:rs1',
    subjectKind: 'ruleSet',
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

/**
 * A query subject and a test over it, in one call.
 *
 * The rule-set helpers above build their subject once because every rule-set
 * test uses the same rule set; a query test varies the query itself, so the
 * query string is the parameter.
 */
function queryTest(
  queryString: string,
  versionFields: Record<string, unknown>,
  cases: Record<string, unknown>[] = [{}],
  // Stored by the query writer in real life, from its own parse. Defaulted
  // here because most of these are SELECTs and naming it every time would
  // bury the one case where it is the point.
  queryType = 'select',
): string {
  put({
    $id: 'urn:sqlib:query-version:qv1',
    '@type': 'QueryVersion',
    isPartOf: 'urn:sqlib:query:q1',
    version: 1,
    queryString,
    queryType,
  });
  put({
    $id: 'urn:sqlib:query:q1',
    '@type': 'Query',
    name: 'Q',
    currentVersion: 'urn:sqlib:query-version:qv1',
  });
  put({
    $id: 'urn:sqlib:test:t1',
    '@type': 'Test',
    name: 'Query test',
    subject: 'urn:sqlib:query:q1',
    subjectKind: 'query',
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

beforeEach(() => {
  hoisted.entities.clear();
});

describe('TestRunner — rule set subjects', () => {
  it('passes when the inference graph matches the expectation', async () => {
    reachabilityRuleSet();
    const testVersionId = test({ expectationKind: 'graph' }, [{
      expected: '<http://ex/a> <http://ex/reaches> <http://ex/b> .',
      dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .'),
    }]);

    const result = await new TestRunner().runTestVersion(testVersionId);
    expect(result.passed).toBe(true);
    expect(result.message).toBe('');
    expect(result.subjectVersionId).toBe('urn:test:rule-set-version:1');
  });

  it('fails with both sides of the difference when it does not', async () => {
    reachabilityRuleSet();
    const testVersionId = test({ expectationKind: 'graph' }, [{
      expected: '<http://ex/a> <http://ex/reaches> <http://ex/z> .',
      dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .'),
    }]);

    const result = await new TestRunner().runTestVersion(testVersionId);
    expect(result.passed).toBe(false);
    expect(result.cases[0].detail?.missing?.[0]).toContain('http://ex/z');
    expect(result.cases[0].detail?.unexpected?.[0]).toContain('http://ex/b');
  });

  it('reads a Turtle expectation when the case says that is what it is', async () => {
    reachabilityRuleSet();
    const testVersionId = test({ expectationKind: 'graph' }, [{
      // The serialisation the author wrote, prefixes and all — which is what a
      // vendored conformance suite hands us and what a reader wants to see on
      // the test's own screen.
      expected: '@prefix : <http://ex/> .\n:a :reaches :b .',
      expectedFormat: 'text/turtle',
      dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .'),
    }]);

    const result = await new TestRunner().runTestVersion(testVersionId);
    expect(result.passed).toBe(true);
  });

  it('says the expectation could not be read, rather than that the subject was wrong', async () => {
    reachabilityRuleSet();
    const testVersionId = test({ expectationKind: 'graph' }, [{
      expected: 'this is not turtle {',
      expectedFormat: 'text/turtle',
      dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .'),
    }]);

    const result = await new TestRunner().runTestVersion(testVersionId);
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/Expected graph could not be read/);
  });

  it('calls a run hermetic when no backend is named, and not when one is', async () => {
    reachabilityRuleSet();
    const hermetic = await new TestRunner().runTestVersion(test(
      { expectationKind: 'smoke' },
      [{ dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .') }],
    ));
    expect(hermetic.hermetic).toBe(true);

    hoisted.entities.clear();
    reachabilityRuleSet();
    const integration = await new TestRunner().runTestVersion(test(
      { expectationKind: 'smoke', backend: 'urn:sqlib:backend:live' },
      [{ dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .') }],
    ));
    // Nothing about the ruleset path uses the backend; the flag records the
    // *claim* the inputs make, which is what marks the test as
    // environment-dependent in a listing.
    expect(integration.hermetic).toBe(false);
  });

  it('passes a smoke test on nothing more than a clean run', async () => {
    reachabilityRuleSet();
    const result = await new TestRunner().runTestVersion(test(
      { expectationKind: 'smoke' },
      [{ dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .') }],
    ));
    expect(result.passed).toBe(true);
    expect(result.expectationKind).toBe('smoke');
  });

  it('runs against an empty base graph when the test names no data graph', async () => {
    reachabilityRuleSet();
    const result = await new TestRunner().runTestVersion(test(
      { expectationKind: 'graph' },
      [{ expected: '' }],
    ));
    // No edges in, so no reaches out — and an empty expectation is a real
    // expectation, not a smoke test.
    expect(result.passed).toBe(true);
  });

  it('resolves the subject to its current version when the test pins none', async () => {
    reachabilityRuleSet();
    const result = await new TestRunner().runTestVersion(test(
      { expectationKind: 'smoke' },
      [{ dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .') }],
    ));
    expect(result.subjectVersionId).toBe('urn:test:rule-set-version:1');
  });

  it('refuses to run rather than guessing when the data graph is gone', async () => {
    reachabilityRuleSet();
    const testVersionId = test(
      { expectationKind: 'smoke' },
      [{ dataGraphVersion: 'urn:sqlib:data-graph-version:deleted' }],
    );

    await expect(new TestRunner().runTestVersion(testVersionId)).rejects.toThrow(TestNotRunnableError);
  });

  it('answers an analysis expectation without invoking the subject', async () => {
    reachabilityRuleSet();
    // No data graph and no backend: an analysis case asks about the document,
    // so there is nothing to run it against.
    const testVersionId = test({ expectationKind: 'analysis' }, [
      { expected: JSON.stringify({ check: 'syntax', accepted: true }) },
    ]);

    const result = await new TestRunner().runTestVersion(testVersionId);
    expect(result.passed).toBe(true);
    expect(result.subjectVersionId).toBe('urn:test:rule-set-version:1');
  });

  it('judges one analysis case per check over the same document', async () => {
    reachabilityRuleSet();
    const testVersionId = test({ expectationKind: 'analysis' }, [
      { name: 'parses', expected: JSON.stringify({ check: 'syntax', accepted: true }) },
      { name: 'stratifies', expected: JSON.stringify({ check: 'stratification', accepted: true }) },
      { name: 'wrong', expected: JSON.stringify({ check: 'syntax', accepted: false }) },
    ]);

    const result = await new TestRunner().runTestVersion(testVersionId);
    expect(result.passedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.cases[2].message).toMatch(/reject the document, but it was accepted/);
  });

  it('refuses to run a test whose subject kind is not one it knows', async () => {
    reachabilityRuleSet();
    put({
      $id: 'urn:sqlib:test:t1',
      '@type': 'Test',
      name: 'Odd',
      subject: 'urn:sqlib:ruleset:rs1',
      // Not a kind, and deliberately not a kind that could become one: this
      // used to say `etlJob`, which stopped being unknown when ETL jobs became
      // a subject kind of their own (issue #153).
      subjectKind: 'spreadsheet',
      isPartOf: ['urn:sqlib:library:lib'],
    });
    const testVersionId = put({
      $id: 'urn:sqlib:test-version:tv1',
      '@type': 'TestVersion',
      isPartOf: 'urn:sqlib:test:t1',
      version: 1,
      expectationKind: 'smoke',
    });

    await expect(new TestRunner().runTestVersion(testVersionId)).rejects.toThrow(/unknown subject kind/);
  });

  /*
   * Parametrised tests: one subject, several inputs, an expectation per input.
   * This is the shape `@pytest.mark.parametrize` produces, and the reason the
   * expectation lives on the case — a different data graph makes a different
   * answer correct.
   */
  it('runs each case against its own inputs and judges it on its own expectation', async () => {
    reachabilityRuleSet();
    const testVersionId = test({ expectationKind: 'graph' }, [
      {
        name: 'one edge',
        dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .', 'text/turtle', 'one'),
        expected: '<http://ex/a> <http://ex/reaches> <http://ex/b> .',
      },
      {
        name: 'other edge',
        dataGraphVersion: dataGraph('@prefix : <http://ex/> . :c :edge :d .', 'text/turtle', 'other'),
        expected: '<http://ex/c> <http://ex/reaches> <http://ex/d> .',
      },
    ]);

    const result = await new TestRunner().runTestVersion(testVersionId);

    expect(result.passed).toBe(true);
    expect(result.passedCount).toBe(2);
    expect(result.cases.map(c => c.name)).toEqual(['one edge', 'other edge']);
    // The dimensions a report cites come off the case, which is why they are
    // carried through rather than re-read from the version.
    expect(result.cases[1].inputs.dataGraphVersion).toBe('urn:sqlib:data-graph-version:other');
  });

  it('keeps running after a case fails, and names the one that did', async () => {
    reachabilityRuleSet();
    const testVersionId = test({ expectationKind: 'graph' }, [
      {
        name: 'good',
        dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .', 'text/turtle', 'one'),
        expected: '<http://ex/a> <http://ex/reaches> <http://ex/b> .',
      },
      {
        name: 'wrong expectation',
        dataGraphVersion: dataGraph('@prefix : <http://ex/> . :c :edge :d .', 'text/turtle', 'other'),
        expected: '<http://ex/c> <http://ex/reaches> <http://ex/zzz> .',
      },
    ]);

    const result = await new TestRunner().runTestVersion(testVersionId);

    // Both ran: "the second of two arguments is wrong" is only visible if the
    // first case's verdict survives the second's failure.
    expect(result.cases).toHaveLength(2);
    expect(result.cases[0].passed).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.failedCount).toBe(1);
    expect(result.message).toMatch(/^wrong expectation: /);
  });

  it('numbers an unnamed case rather than leaving a report with a blank row', async () => {
    reachabilityRuleSet();
    const result = await new TestRunner().runTestVersion(test({ expectationKind: 'smoke' }, [{}, {}]));

    expect(result.cases.map(c => c.name)).toEqual(['Case 1', 'Case 2']);
  });

  it('runs a version written before cases existed as a single smoke case', async () => {
    reachabilityRuleSet();
    // No TestCase entities at all — the shape stored by the pre-parametrise
    // writer. It still runs once rather than reporting a vacuous pass.
    put({
      $id: 'urn:sqlib:test:t1',
      '@type': 'Test',
      name: 'Legacy',
      subject: 'urn:sqlib:ruleset:rs1',
      subjectKind: 'ruleSet',
      isPartOf: ['urn:sqlib:library:lib'],
    });
    const testVersionId = put({
      $id: 'urn:sqlib:test-version:tv1',
      '@type': 'TestVersion',
      isPartOf: 'urn:sqlib:test:t1',
      version: 1,
      expectationKind: 'smoke',
    });

    const result = await new TestRunner().runTestVersion(testVersionId);
    expect(result.cases).toHaveLength(1);
    expect(result.passed).toBe(true);
  });

  it('turns a query test with no store at all into a clear refusal, not a wrong answer', async () => {
    const testVersionId = queryTest('SELECT * WHERE { ?s ?p ?o }', { expectationKind: 'smoke' }, [{}]);

    await expect(new TestRunner().runTestVersion(testVersionId))
      .rejects.toThrow(/needs somewhere to run/);
  });
});

/**
 * Query subjects, run hermetically.
 *
 * The same claim the rule set tests above make, for the kind that until now
 * could not make it: with a data graph on the case and no backend, a query runs
 * against a store that exists only for that case, so the assertions here are
 * about real SPARQL results rather than a mocked executor.
 */
describe('TestRunner — query subjects, hermetic', () => {
  it('runs a SELECT against the case data graph and judges the bindings', async () => {
    const testVersionId = queryTest(
      'SELECT ?o WHERE { <http://ex/a> <http://ex/edge> ?o }',
      { expectationKind: 'bindings' },
      [{
        dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .'),
        expected: JSON.stringify({
          head: { vars: ['o'] },
          results: { bindings: [{ o: { type: 'uri', value: 'http://ex/b' } }] },
        }),
      }],
    );

    const result = await new TestRunner().runTestVersion(testVersionId);
    expect(result.passed).toBe(true);
    // The whole point of the hermetic path: no backend, and the run still
    // happened rather than being refused.
    expect(result.hermetic).toBe(true);
  });

  it('runs an ASK against the case data graph', async () => {
    const testVersionId = queryTest(
      'ASK { <http://ex/a> <http://ex/edge> <http://ex/b> }',
      { expectationKind: 'boolean' },
      [{
        dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .'),
        expected: 'true',
      }],
      'ask',
    );

    expect((await new TestRunner().runTestVersion(testVersionId)).passed).toBe(true);
  });

  it('gives each case its own store, so one case cannot see another\'s data', async () => {
    // The failure this guards against is the subtle one: with a shared store,
    // case two would inherit case one's triples and pass while asserting
    // emptiness — a green test that proves nothing.
    const testVersionId = queryTest(
      'SELECT ?o WHERE { <http://ex/a> <http://ex/edge> ?o }',
      { expectationKind: 'bindings' },
      [
        {
          dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .', 'text/turtle', 'full'),
          expected: JSON.stringify({
            head: { vars: ['o'] },
            results: { bindings: [{ o: { type: 'uri', value: 'http://ex/b' } }] },
          }),
        },
        {
          dataGraphVersion: dataGraph('@prefix : <http://ex/> . :c :edge :d .', 'text/turtle', 'other'),
          expected: JSON.stringify({ head: { vars: ['o'] }, results: { bindings: [] } }),
        },
      ],
    );

    const result = await new TestRunner().runTestVersion(testVersionId);
    expect(result.passed).toBe(true);
    expect(result.passedCount).toBe(2);
  });

  it('refuses a test that names both a backend and a data graph', async () => {
    const testVersionId = queryTest(
      'SELECT * WHERE { ?s ?p ?o }',
      { expectationKind: 'smoke', backend: 'urn:sqlib:backend:live' },
      [{ dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .') }],
    );

    // Not "prefer one": which store a query runs against is the difference
    // between a hermetic test and an integration one, and picking for the
    // author would decide that silently.
    await expect(new TestRunner().runTestVersion(testVersionId))
      .rejects.toThrow(/one store/);
  });

  it('reports a query that does not parse as a failing case, not a broken run', async () => {
    const testVersionId = queryTest(
      'SELECT ?o WHERE { this is not sparql',
      { expectationKind: 'smoke' },
      [{ dataGraphVersion: dataGraph('@prefix : <http://ex/> . :a :edge :b .') }],
    );

    const result = await new TestRunner().runTestVersion(testVersionId);
    expect(result.passed).toBe(false);
    expect(result.cases[0].message).toMatch(/Subject failed/);
  });
});
