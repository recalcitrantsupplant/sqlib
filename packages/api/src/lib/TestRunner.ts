/**
 * Running a test: invoke the subject, compare what came back.
 *
 * The invocation half is the shape benchmarks already discovered — a callable
 * plus its inputs (`BenchmarkSubjectSpec`). The two entities stay separate
 * because their *run semantics* differ (a test runs once and is judged; a
 * benchmark runs many times and is measured), but the vocabulary is shared, and
 * this runner reaches the same executors through the same seams.
 *
 * **Hermetic versus integration is not a flag.** A case with a
 * `dataGraphVersion` runs against an ephemeral store seeded from that graph and
 * is deterministic; a test with a `backend` reaches a live endpoint and is
 * environment-dependent. Both facts are read off the inputs, so they cannot
 * drift from what the test actually does — which is exactly what a stored
 * boolean would eventually do.
 *
 * That holds for every subject kind. A rule set seeds its base graph `G0` from
 * the case's data graph; a query runs against a store loaded from it. The two
 * reach the same `OxigraphStoreManager` ephemeral store by different routes
 * only because a rule set's executor owns its store and a query's does not.
 *
 * **A version runs its cases, not itself.** Each case carries its own inputs
 * and its own expectation, so the loop below invokes the subject once per case
 * and judges each independently; a single-case test is the degenerate shape of
 * that, not a separate path.
 */

import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { mintId } from './id.js';
import { isSubjectKind, type SubjectKind } from './subjectKinds.js';
import { oxigraphStoreManager } from './OxigraphStoreManager.js';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import type { ISparqlExecutor } from '../server/ISparqlExecutor.js';
import { ArgumentSetService } from './ArgumentSetService.js';
import { ExecutorFactory } from './orchestration/ExecutorFactory.js';
import { ExecutionEngine, type ExecutionHooks, type ExecutionDataGraphInput } from './orchestration/ExecutionEngine.js';
import { GraphBuilder } from './orchestration/GraphBuilder.js';
import { SparqlQueryParser } from './parser.js';
import { RuleSetExecutor } from './RuleSetExecutor.js';
import { QueryTypeIri, toQueryTypeIri } from '../constants/queryTypes.js';
import type { LdkitTest } from '../persistence/schemas/TestSchema.js';
import type { LdkitTestVersion } from '../persistence/schemas/TestVersionSchema.js';
import type { LdkitTestCase } from '../persistence/schemas/TestCaseSchema.js';
import type { LdkitQuery } from '../persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { LdkitQueryGroup } from '../persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryGroupVersion } from '../persistence/schemas/QueryGroupVersionSchema.js';
import type { LdkitRuleSet } from '../persistence/schemas/RuleSetSchema.js';
import type { LdkitRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import type { LdkitEtlJob } from '../persistence/schemas/EtlJobSchema.js';
import type { LdkitEtlJobVersion } from '../persistence/schemas/EtlJobVersionSchema.js';
import type { LdkitDataGraphVersion } from '../persistence/schemas/DataGraphVersionSchema.js';
import type { ResolvedNode } from './orchestration/types.js';
import type { EntityTypeName } from '../persistence/entityTypeNames.js';
import { rdfToNQuads, storeManagerFormat, DEFAULT_DATA_GRAPH_FORMAT, type DataGraphFormat } from './dataGraphContent.js';
import { effectiveCases, listCaseDataGraphs } from './testCases.js';
import { mergeRuleSet } from '@sparql-query-lib/srl';
import { isSrlCheck, runSrlCheck, type SrlCheck, type SrlCheckVerdict } from './srlChecks.js';
import { etlService } from './EtlService.js';
import { duckDbService } from './DuckDbService.js';
import type { LdkitDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import type { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import {
  compareAnalysis,
  compareBindings,
  compareBoolean,
  compareGraphs,
  compareSmoke,
  isExpectationKind,
  type ComparisonResult,
  type ExpectationKind,
} from './testComparators.js';

/** Id lists are stored as one-or-many, as everywhere else that reads them. */
function normalizeIdList(value: unknown): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.map(entry => String(entry)) : [String(value)];
}

/**
 * Which check the expectation names.
 *
 * Read before the analysis rather than after, so that a malformed expectation
 * is caught while the reason is still "this test is wrong" — the comparator
 * then reports the mismatch, but it needs *a* check to have been run.
 */
function readCheck(expected: string | null | undefined): SrlCheck {
  try {
    const parsed = JSON.parse(expected ?? '') as { check?: unknown };
    if (isSrlCheck(parsed?.check)) return parsed.check;
  } catch {
    // Falls through to the default; the comparator reports what was wrong with
    // the expectation, which is a better message than anything thrown here.
  }
  return 'syntax';
}

/**
 * Cap on the produced result carried back in a run response.
 *
 * Generous enough for any graph a rule set infers in practice and for a
 * bindings page, small enough that a runaway query cannot turn a verdict into a
 * megabyte. Truncation is reported rather than hidden — a reader comparing a
 * result against an expectation has to know they are looking at part of it.
 */
const MAX_RESULT_CHARS = 64 * 1024;

/**
 * Cap on the rows a hermetic ETL run may read.
 *
 * Every row becomes a `VALUES` entry in a SPARQL query and then triples in an
 * in-process store, so an unbounded fixture is an unbounded store. Failing past
 * the cap rather than truncating is the rule #153 set for SPARQL-sourced data
 * graphs and #211 applied to the tuple-set sink: a partial result compared
 * against a whole expectation is a red test that says nothing.
 */
const MAX_ETL_TEST_ROWS = 50_000;

/** Render whatever a subject produced as text, capped. */
function renderResult(produced: unknown): { result?: string; resultTruncated?: boolean } {
  if (produced === undefined) return {};
  const text = typeof produced === 'string' ? produced : JSON.stringify(produced, null, 2);
  if (typeof text !== 'string') return {};
  if (text.length <= MAX_RESULT_CHARS) return { result: text };
  return { result: text.slice(0, MAX_RESULT_CHARS), resultTruncated: true };
}

/*
 * The kinds and their input rules live in `subjectKinds`, shared with the
 * writer so a version cannot validate one way and run another. Re-exported
 * here because the routes have always reached for them through the runner.
 */
export {
  SUBJECT_KINDS,
  isSubjectKind,
  ENTITY_TYPE_FOR_SUBJECT_KIND,
  type SubjectKind,
} from './subjectKinds.js';

/**
 * One case's verdict.
 *
 * This is what an `earl:Assertion` is minted from, which is why the case id is
 * on it: the criterion an assertion cites is the case, not the version — a
 * version pins several, and several outcomes citing one criterion is exactly
 * what `earl:test` exists to discriminate.
 */
export interface TestCaseResult {
  caseId: string;
  /** The case's own label, or `Case N` when it has none. */
  name: string;
  position: number;
  passed: boolean;
  /** Why it failed, or why it could not run. Empty on a pass. */
  message: string;
  detail?: ComparisonResult['detail'];
  /**
   * What the subject actually produced, as text.
   *
   * The diff says what *differs*; this is the thing itself, which is what a
   * reader wants when a test passes (is it right for the right reason?) and
   * when the diff is long enough to be unreadable. Capped, with
   * `resultTruncated` set when it was: a bindings document over a live backend
   * has no bound on its size, and a run response is not a download.
   */
  result?: string;
  resultTruncated?: boolean;
  /** The inputs this case ran with — the dimensions a report records. */
  inputs: {
    argumentSetVersion: string | null;
    /**
     * The first RDF input, or `null` when the case supplies none.
     *
     * Kept beside `dataGraphVersions` for readers written before a case could
     * supply several (issue #298). It is the whole truth for every
     * single-graph case, which is every case a rule set or a query can have.
     */
    dataGraphVersion: string | null;
    /** Every RDF input, in the order the case supplies them. */
    dataGraphVersions: string[];
  };
  durationMs: number;
}

export interface TestRunResult {
  testId: string;
  testVersionId: string;
  /** True only when every case passed. One red case is a red test. */
  passed: boolean;
  /** A one-line summary across the cases. Empty when they all passed. */
  message: string;
  expectationKind: ExpectationKind;
  /** True when the run touched no live backend and so is reproducible. */
  hermetic: boolean;
  durationMs: number;
  /** The subject version actually invoked, pinned or resolved. */
  subjectVersionId: string | null;
  ranAt: string;
  cases: TestCaseResult[];
  passedCount: number;
  failedCount: number;
}

export class TestNotRunnableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestNotRunnableError';
  }
}

function get<T>(id: string | null | undefined, type: string): T | null {
  if (!id) return null;
  const entity = getCacheCoordinator().get(id) as (T & { '@type'?: string }) | null;
  if (!entity || entity['@type'] !== type) return null;
  return entity;
}

export class TestRunner {
  constructor(
    private readonly argumentSetService = new ArgumentSetService(),
    private readonly executorFactory = new ExecutorFactory(),
    private readonly parser = new SparqlQueryParser(),
    private readonly graphBuilder = new GraphBuilder(),
  ) {}

  async runTestVersion(testVersionId: string): Promise<TestRunResult> {
    const testVersion = get<LdkitTestVersion>(testVersionId, 'TestVersion');
    if (!testVersion) {
      throw new TestNotRunnableError(`TestVersion ${testVersionId} not found`);
    }
    const test = get<LdkitTest>(testVersion.isPartOf, 'Test');
    if (!test) {
      throw new TestNotRunnableError(`Test ${testVersion.isPartOf} not found`);
    }

    const expectationKind = isExpectationKind(testVersion.expectationKind)
      ? testVersion.expectationKind
      : 'smoke';
    const startedAt = Date.now();

    const subjectKind = test.subjectKind;
    if (!isSubjectKind(subjectKind)) {
      throw new TestNotRunnableError(`Test ${test.$id} has an unknown subject kind "${subjectKind}"`);
    }

    /*
     * An ETL job produces one thing: the RDF its SPARQL template constructs
     * from the rows its SQL read. So the graph comparator is the only one that
     * has anything to compare, and `smoke` — "it ran" — is the only other
     * question worth asking of it.
     *
     * Judging the mapped rows instead, as a `bindings` expectation, is a
     * coherent thing to want and is deliberately not here: the runner invokes
     * the subject before it knows the expectation kind, so producing a
     * different value for a different kind is a change to every subject kind
     * for the benefit of one. Refused with the reason rather than compared
     * against something the subject never produced.
     */
    if (subjectKind === 'etlJob' && expectationKind !== 'graph' && expectationKind !== 'smoke') {
      throw new TestNotRunnableError(
        `An ETL job produces the RDF its template constructs, so a ${expectationKind} expectation has nothing to compare. `
        + 'Use a graph expectation, or smoke to assert only that the job ran.',
      );
    }

    // No backend named means nothing left the process — the definition of
    // hermetic here, and the reason it needs no separate field.
    //
    // Except for a query group, which never names one: its nodes carry their
    // own backends, so the test's silence says nothing about where the run
    // went. Reported as integration rather than guessed at, because `hermetic`
    // is not a badge — it is emitted into every EARL, CSV and JUnit report, and
    // a run wrongly recorded as reproducible is the one error a report cannot
    // be checked against later. Narrowing this to "hermetic when no node names
    // a backend" is a query-group question, answerable once the group is built.
    //
    // An ETL job names no backend either, and its template runs against a store
    // this runner made — but its SQL is the other half of the run, and a
    // deployment that grants DuckDB the filesystem or HTTP lets that SQL read
    // something outside the process. So the claim is read off the capability
    // profile in force, which is the thing that actually decides it.
    const hermetic = subjectKind === 'queryGroup'
      ? false
      : subjectKind === 'etlJob'
        ? duckDbService.isSandboxed()
        : !testVersion.backend;

    const cases = effectiveCases(testVersion.$id);
    const results: TestCaseResult[] = [];
    let subjectVersionId: string | null = null;

    // Cases run in order and each is judged on its own. A failing case does not
    // stop the ones after it: the row-by-row report is the point, and "the
    // second of five arguments is wrong" is only visible if the rest still ran.
    for (const [index, testCase] of cases.entries()) {
      const caseStartedAt = Date.now();
      /*
       * Read once for the report, from the same place the invocation reads it,
       * so a case cannot run against one set of graphs and be recorded as
       * having used another. Ids only — the content is resolved at invocation.
       */
      const caseDataGraphVersions = this.caseDataGraphVersionIds(testCase);
      const finishCase = (comparison: ComparisonResult): TestCaseResult => ({
        ...renderResult(produced),
        caseId: testCase.$id,
        name: testCase.name?.trim() || `Case ${index + 1}`,
        position: typeof testCase.position === 'number' ? testCase.position : index,
        passed: comparison.passed,
        message: comparison.passed ? '' : comparison.message,
        detail: comparison.detail,
        inputs: {
          argumentSetVersion: testCase.argumentSetVersion ?? null,
          dataGraphVersion: caseDataGraphVersions[0] ?? null,
          dataGraphVersions: caseDataGraphVersions,
        },
        durationMs: Date.now() - caseStartedAt,
      });

      let produced: unknown;
      try {
        // Analysis asks about the document, not about what running it produces —
        // so it must not run it. A third of the W3C rules suite asserts that a
        // document is *rejected*, and a rejected document has nothing to
        // execute. Per case like everything else: a version could pin one case
        // per check over the same document.
        if (expectationKind === 'analysis') {
          const analysed = this.analyse(test.subject, subjectKind, testVersion, testCase);
          subjectVersionId = analysed.subjectVersionId;
          results.push(finishCase(compareAnalysis(analysed.verdict, testCase.expected ?? '')));
          continue;
        }

        const invocation = await this.invoke(test.subject, subjectKind, testVersion, testCase);
        subjectVersionId = invocation.subjectVersionId;
        produced = invocation.result;

        // A smoke case's expectation is that the invocation above did not throw.
        if (expectationKind === 'smoke' || testCase.expected === null || testCase.expected === undefined) {
          results.push(finishCase(compareSmoke()));
          continue;
        }
        results.push(finishCase(await this.compare(expectationKind, invocation.result, testCase)));
      } catch (error) {
        // A test that cannot run at all — no subject version, no backend for a
        // query — is a broken run rather than a red test, and says so once
        // instead of once per case.
        if (error instanceof TestNotRunnableError) throw error;
        // Anything else is the subject failing, which is a failing case: the
        // report is the point, and one exploding subject must not end a suite.
        const message = error instanceof Error ? error.message : String(error);
        results.push(finishCase({ passed: false, message: `Subject failed: ${message}` }));
      }
    }

    const failed = results.filter(result => !result.passed);
    return {
      testId: test.$id,
      testVersionId: testVersion.$id,
      passed: failed.length === 0,
      message: this.summarise(results, failed),
      expectationKind,
      hermetic,
      durationMs: Date.now() - startedAt,
      subjectVersionId,
      ranAt: new Date().toISOString(),
      cases: results,
      passedCount: results.length - failed.length,
      failedCount: failed.length,
    };
  }

  /**
   * One line for the whole test. A single-case test reads exactly as it did
   * before cases existed — its one message, unprefixed — because that is still
   * the common shape and wrapping it in "1 of 1 cases failed" only adds noise.
   */
  private summarise(results: TestCaseResult[], failed: TestCaseResult[]): string {
    if (failed.length === 0) return '';
    if (results.length === 1) return failed[0].message;
    if (failed.length === 1) return `${failed[0].name}: ${failed[0].message}`;
    return `${failed.length} of ${results.length} cases failed`;
  }

  /** Run every current version in a set of tests, in order, collecting verdicts. */
  async runTests(testIds: string[]): Promise<TestRunResult[]> {
    const results: TestRunResult[] = [];
    for (const testId of testIds) {
      const test = get<LdkitTest>(testId, 'Test');
      if (!test?.currentVersion) continue;
      results.push(await this.runTestVersion(test.currentVersion));
    }
    return results;
  }

  /**
   * Reconstruct the subject's SRL document and run one check over it.
   *
   * Reconstructed from the stored rules rather than kept as a second copy of
   * the text: the test has to judge *what the library holds*, or editing a rule
   * would leave the test judging the document it was written from. Merging with
   * an empty prologue gives the canonical, expanded-IRI form, which every check
   * is invariant under — a rule set stored and merged back is accepted or
   * rejected exactly as the document it came from was.
   *
   * A rule set saved through the invalid-save override holds its document as a
   * single unparseable rule, and merging one rule returns it unchanged. That is
   * what makes a negative syntax test expressible at all.
   */
  private analyse(
    subjectId: string,
    subjectKind: SubjectKind,
    testVersion: LdkitTestVersion,
    testCase: LdkitTestCase,
  ): { verdict: SrlCheckVerdict; subjectVersionId: string | null } {
    if (subjectKind !== 'ruleSet') {
      throw new TestNotRunnableError(
        `An analysis expectation asks whether an SRL document is accepted, so its subject must be a rule set, not a ${subjectKind}`,
      );
    }

    const version = testVersion.subjectVersion
      ? get<LdkitRuleSetVersion>(testVersion.subjectVersion, 'RuleSetVersion')
      : this.currentVersionOf<LdkitRuleSetVersion>(subjectId, 'RuleSet', 'RuleSetVersion');
    if (!version) {
      throw new TestNotRunnableError(`No rule set version to analyse for subject ${subjectId}`);
    }

    const check = readCheck(testCase.expected);
    const rules = normalizeIdList(version.hasRule)
      .map(id => get<LdkitRuleVersion>(id, 'RuleVersion'))
      .filter((rule): rule is LdkitRuleVersion => Boolean(rule))
      .map(rule => ({ text: rule.ruleString ?? '' }));
    const dataBlocks = normalizeIdList(version.hasDataBlock)
      .map(id => get<LdkitDataBlockVersion>(id, 'DataBlockVersion'))
      .filter((block): block is LdkitDataBlockVersion => Boolean(block))
      .map(block => ({ text: block.dataString ?? '' }));

    return {
      verdict: runSrlCheck(mergeRuleSet(rules, '', dataBlocks), check),
      subjectVersionId: version.$id,
    };
  }

  private async compare(
    expectationKind: ExpectationKind,
    result: unknown,
    testCase: LdkitTestCase,
  ): Promise<ComparisonResult> {
    const expected = testCase.expected ?? '';
    switch (expectationKind) {
      case 'graph': {
        // `expectedFormat` is what lets an expectation be stored in the
        // serialisation it was written in — a vendored suite's `.ttl`, a graph
        // pasted from a CONSTRUCT — rather than forcing every author to
        // pre-convert to the N-Quads the comparator reduces isomorphism to.
        let expectedNQuads: string;
        try {
          expectedNQuads = testCase.expectedFormat
            ? rdfToNQuads(expected, testCase.expectedFormat)
            : expected;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { passed: false, message: `Expected graph could not be read: ${message}` };
        }
        return compareGraphs(typeof result === 'string' ? result : String(result ?? ''), expectedNQuads);
      }
      case 'boolean':
        return compareBoolean(result, expected.trim() === 'true');
      case 'bindings': {
        let parsed: unknown;
        try {
          parsed = JSON.parse(expected);
        } catch {
          return { passed: false, message: 'Expected bindings are not valid JSON' };
        }
        return compareBindings(result, parsed, { ordered: testCase.ordered === true });
      }
      case 'analysis':
        // Unreachable: `runTestVersion` answers an analysis expectation before
        // invoking anything, because analysing a document that must be rejected
        // cannot go through an executor. Stated rather than defaulted so the
        // compiler holds the two branches together if a kind is ever added.
        return { passed: false, message: 'An analysis expectation is answered without invoking the subject' };
      case 'smoke':
        return compareSmoke();
    }
  }

  /**
   * Invoke the subject and return whatever it produced.
   *
   * Bindings and booleans come back as the SPARQL JSON documents the executors
   * return; a graph comes back as N-Quads text, which is what the graph
   * comparator canonicalises.
   */
  private async invoke(
    subjectId: string,
    subjectKind: SubjectKind,
    testVersion: LdkitTestVersion,
    testCase: LdkitTestCase,
  ): Promise<{ result: unknown; subjectVersionId: string | null }> {
    switch (subjectKind) {
      case 'ruleSet':
        return this.invokeRuleSet(subjectId, testVersion, testCase);
      case 'query':
        return this.invokeQuery(subjectId, testVersion, testCase);
      case 'queryGroup':
        return this.invokeQueryGroup(subjectId, testVersion, testCase);
      case 'etlJob':
        return this.invokeEtlJob(subjectId, testVersion, testCase);
    }
  }

  /**
   * Run an ETL job hermetically: rows from the case's fixture, triples out.
   *
   * Every step the real job takes is kept — the SQL, the column mapping, the
   * SPARQL template — and exactly one thing is substituted: the executor. The
   * job version's `backendId` is not consulted, because a test that wrote into
   * the store the job shares with production would have a side effect on the
   * thing it is meant to be watching. The template runs against a store that
   * exists only for this case, seeded from the case's data graph when it names
   * one, so a template that joins against existing data is still testable.
   *
   * The fixture goes to DuckDB rather than here: `streamChunks` runs it on a
   * private database, so nothing it creates outlives the case or is visible to
   * another.
   */
  private async invokeEtlJob(
    subjectId: string,
    testVersion: LdkitTestVersion,
    testCase: LdkitTestCase,
  ): Promise<{ result: unknown; subjectVersionId: string | null }> {
    const version = testVersion.subjectVersion
      ? get<LdkitEtlJobVersion>(testVersion.subjectVersion, 'EtlJobVersion')
      : this.currentVersionOf<LdkitEtlJobVersion>(subjectId, 'EtlJob', 'EtlJobVersion');
    if (!version) {
      throw new TestNotRunnableError(`No ETL job version to run for subject ${subjectId}`);
    }

    const dataGraph = this.resolveDataGraph(testCase);
    const storeId = `${mintId('testCase')}:etl`;
    const store = oxigraphStoreManager.createEphemeralStore(storeId);
    try {
      if (dataGraph && dataGraph.content.trim()) {
        await oxigraphStoreManager.loadDataFromString(store, dataGraph.content.trim(), dataGraph.format);
      }

      // One CONSTRUCT result per chunk, each already N-Quads because the
      // executor is Oxigraph's. Held in memory here, which a job execution
      // must not do, because `MAX_ETL_TEST_ROWS` bounds what a test may
      // construct. Concatenated rather than merged: N-Quads is line-based, so
      // the join *is* the union.
      const rdfOutputs: string[] = [];
      await etlService.runPipeline({
        sql: version.sql,
        sparqlTemplate: version.sparqlTemplate,
        columnDefs: etlService.resolveColumnMapping(version).columns,
        executor: new OxigraphSparqlExecutor(store),
        chunkSize: version.chunkSize || 1000,
        fixtureSql: testCase.sqlFixture,
        maxRows: MAX_ETL_TEST_ROWS,
        maxRowsPolicy: 'fail',
        onOutput: async rdf => { rdfOutputs.push(rdf); },
      });

      return { result: rdfOutputs.join('\n'), subjectVersionId: version.$id };
    } finally {
      oxigraphStoreManager.destroyEphemeralStore(storeId);
    }
  }

  private async invokeRuleSet(
    subjectId: string,
    testVersion: LdkitTestVersion,
    testCase: LdkitTestCase,
  ): Promise<{ result: unknown; subjectVersionId: string | null }> {
    const version = testVersion.subjectVersion
      ? get<LdkitRuleSetVersion>(testVersion.subjectVersion, 'RuleSetVersion')
      : this.currentVersionOf<LdkitRuleSetVersion>(subjectId, 'RuleSet', 'RuleSetVersion');
    if (!version) {
      throw new TestNotRunnableError(`No rule set version to run for subject ${subjectId}`);
    }

    const dataGraph = this.resolveDataGraph(testCase);
    const executed = await new RuleSetExecutor().execute(
      // Tuple seeds on the case override the version's own, so one rule set can
      // be tested against several inputs without cutting a version per input.
      testCase.tupleSeeds ? { ...version, tupleSeeds: testCase.tupleSeeds } : version,
      {
        maxIterations: testVersion.maxIterations ?? undefined,
        timeoutMs: testVersion.timeoutMs ?? undefined,
        initialGraph: dataGraph?.content ?? null,
        initialGraphFormat: dataGraph?.format ?? null,
      },
    );

    if (executed.status === 'failed') {
      // The executor's own sentence, not a restatement of the status. For a
      // conformance suite this is most of the value: "RuleSet contains invalid
      // RuleVersions: …" names the construct we have not implemented, where
      // "execution failed" only repeats that the test is red.
      throw new Error(executed.error ?? 'Rule set execution failed');
    }
    return { result: executed.finalGraphNQuads ?? '', subjectVersionId: version.$id };
  }

  private async invokeQuery(
    subjectId: string,
    testVersion: LdkitTestVersion,
    testCase: LdkitTestCase,
  ): Promise<{ result: unknown; subjectVersionId: string | null }> {
    const version = testVersion.subjectVersion
      ? get<LdkitQueryVersion>(testVersion.subjectVersion, 'QueryVersion')
      : this.currentVersionOf<LdkitQueryVersion>(subjectId, 'Query', 'QueryVersion');
    if (!version) {
      throw new TestNotRunnableError(`No query version to run for subject ${subjectId}`);
    }

    let queryString = version.queryString;
    if (testCase.argumentSetVersion) {
      const payload = await this.argumentSetService.exportRuntimePayload([testCase.argumentSetVersion]);
      if (payload.limits.length > 0 || payload.offsets.length > 0) {
        queryString = this.parser.applyLimitOffsetParameters(queryString, payload.limits, payload.offsets);
      }
      if (payload.tupleList.length > 0) {
        queryString = this.parser.applyArguments(queryString, payload.tupleList);
      }
    }

    const queryType = toQueryTypeIri(version.queryType) || QueryTypeIri.select;
    const result = await this.withQueryExecutor(
      testVersion,
      testCase,
      executor => this.runQuery(executor, queryString, queryType),
    );
    return { result, subjectVersionId: version.$id };
  }

  /** Ask the executor the question the query's type calls for. */
  private async runQuery(
    executor: ISparqlExecutor,
    queryString: string,
    queryType: string,
  ): Promise<unknown> {
    if (queryType === QueryTypeIri.ask) {
      return (await executor.askQuery(queryString)).result;
    }
    if (queryType === QueryTypeIri.construct || queryType === QueryTypeIri.describe) {
      return (await executor.constructQueryParsed(queryString)).result;
    }
    return (await executor.selectQueryParsed(queryString)).result;
  }

  /**
   * Run one query case against the store its inputs name.
   *
   * The two stores are alternatives, not a fallback chain: a backend on the
   * version reaches a live endpoint, and a data graph on the case is loaded
   * into a store that exists only for this case. Which of the two a test uses
   * is the difference between an integration test and a hermetic one, so
   * preferring either when both are set would decide that silently for the
   * author. The writer refuses the combination (`TestVersionWriter`); this
   * refuses it again rather than trusting what is stored.
   *
   * The ephemeral store is destroyed in `finally`, so a case that throws does
   * not leave its data behind for the next one — which in a parametrised test
   * would make case N's verdict depend on case N-1's data.
   */
  private async withQueryExecutor<T>(
    testVersion: LdkitTestVersion,
    testCase: LdkitTestCase,
    run: (executor: ISparqlExecutor) => Promise<T>,
  ): Promise<T> {
    const dataGraph = this.resolveDataGraph(testCase);

    if (testVersion.backend && dataGraph) {
      throw new TestNotRunnableError(
        'This test names both a backend and a data graph. A query runs against one store: '
        + 'drop the backend to run hermetically, or drop the data graph to run against the backend.',
      );
    }

    if (testVersion.backend) {
      return run(await this.resolveExecutor(testVersion));
    }

    if (!dataGraph) {
      throw new TestNotRunnableError(
        'A query or group test needs somewhere to run: name a backend, or give the case a data graph to run against hermetically.',
      );
    }

    // The same seam a rule set's base graph uses (`dataGraphInput`): a store
    // that exists only inside this invocation, seeded from the version's bytes,
    // so the same case is the same run forever.
    const storeId = `${mintId('testCase')}:query`;
    const store = oxigraphStoreManager.createEphemeralStore(storeId);
    try {
      const content = dataGraph.content.trim();
      if (content) {
        await oxigraphStoreManager.loadDataFromString(store, content, dataGraph.format);
      }
      return await run(new OxigraphSparqlExecutor(store));
    } finally {
      oxigraphStoreManager.destroyEphemeralStore(storeId);
    }
  }

  private async invokeQueryGroup(
    subjectId: string,
    testVersion: LdkitTestVersion,
    testCase: LdkitTestCase,
  ): Promise<{ result: unknown; subjectVersionId: string | null }> {
    const version = testVersion.subjectVersion
      ? get<LdkitQueryGroupVersion>(testVersion.subjectVersion, 'QueryGroupVersion')
      : this.currentVersionOf<LdkitQueryGroupVersion>(subjectId, 'QueryGroup', 'QueryGroupVersion');
    if (!version) {
      throw new TestNotRunnableError(`No query group version to run for subject ${subjectId}`);
    }

    const payload = testCase.argumentSetVersion
      ? await this.argumentSetService.exportRuntimePayload([testCase.argumentSetVersion])
      : null;
    const initialArgs = payload?.tupleList ?? [];

    /*
     * A group's input slots are independent: the argument set fills the start
     * node's tuples, and a graph fills an RDF input the start node declares. A
     * case may name either or both, so neither is read as a choice against the
     * other. The engine refuses a graph the group has nowhere to put, and a
     * declared input left empty, rather than running short of data.
     *
     * A set may now carry graph bindings itself, so its graphs come first and
     * the case's complete whatever it left open — the same order `/execute`
     * merges them in. The writer has already refused an overlap, so there is
     * none to resolve here.
     */
    const dataGraphs = [...(payload?.dataGraphs ?? []), ...this.resolveDataGraphs(testCase)];

    const hooks: ExecutionHooks = { onNodeFinish: () => {}, onNodeError: () => {} };
    const graph = this.graphBuilder.buildFromGroupVersion(version);
    const { result } = await new ExecutionEngine().execute(graph, initialArgs, hooks, {
      dataGraphs,
      // Discarded until now: a group run refused numbers, so a set carrying
      // them ran without them and said nothing.
      limits: payload?.limits ?? [],
      offsets: payload?.offsets ?? [],
    });
    return { result, subjectVersionId: version.$id };
  }

  /**
   * The subject's current version, when the test does not pin one.
   *
   * Both readings are legitimate and the test says which it wants: a pinned
   * version is a conformance test against the thing it was written for; an
   * unpinned one is a regression test against whatever the subject is now.
   */
  private currentVersionOf<T>(subjectId: string, parentType: EntityTypeName, versionType: EntityTypeName): T | null {
    const parent = get<LdkitQuery | LdkitQueryGroup | LdkitRuleSet | LdkitEtlJob>(subjectId, parentType);
    if (!parent) return null;
    const currentVersion = (parent as { currentVersion?: string | null }).currentVersion;
    if (currentVersion) {
      const pinned = get<T>(currentVersion, versionType);
      if (pinned) return pinned;
    }
    // No `currentVersion` pointer, or one that no longer resolves: fall back to
    // the highest-numbered version, which is what the execute routes do.
    const versions = (getCacheCoordinator().list(versionType) as unknown as Array<T & { isPartOf?: string; version?: number }>)
      .filter(version => version.isPartOf === subjectId)
      .sort((a, b) => (Number(a.version) || 0) - (Number(b.version) || 0));
    return versions.at(-1) ?? null;
  }

  /**
   * The case's single RDF input, for a subject that runs against one store.
   *
   * A rule set and a query each have exactly one, so a case naming several is
   * refused here rather than silently reduced to its first: dropping the rest
   * would produce a verdict on data the case did not describe.
   */
  private resolveDataGraph(testCase: LdkitTestCase): { content: string; format: string } | null {
    const graphs = this.resolveDataGraphs(testCase);
    if (graphs.length === 0) return null;
    if (graphs.length > 1) {
      throw new TestNotRunnableError(
        `This case supplies ${graphs.length} data graphs, but its subject runs against a single store. ` +
          `Only a query group has more than one RDF input.`,
      );
    }
    return { content: graphs[0]!.content, format: graphs[0]!.format };
  }

  /**
   * The case's RDF inputs, in the order they fill the start node's declared
   * inputs.
   *
   * The single `dataGraphVersion` reads as the one-element list, so every case
   * stored before `dataGraphs` existed runs unchanged and no call site has to
   * ask which spelling a case used. `TestVersionWriter` refuses a case setting
   * both, so the two branches here cannot both be populated.
   */
  /**
   * The DataGraphVersion ids a case supplies, in order.
   *
   * The ids alone, for the report. Deliberately does not resolve content: a
   * case naming a version that no longer exists should fail at invocation with
   * `TestNotRunnableError`, not while a verdict object is being built.
   */
  private caseDataGraphVersionIds(testCase: LdkitTestCase): string[] {
    const stored = listCaseDataGraphs(testCase.$id);
    if (stored.length > 0) return stored.map(entry => entry.dataGraphVersion);
    return testCase.dataGraphVersion ? [testCase.dataGraphVersion] : [];
  }

  private resolveDataGraphs(testCase: LdkitTestCase): ExecutionDataGraphInput[] {
    const stored = listCaseDataGraphs(testCase.$id);
    // Already sorted by `position`: a case's graphs are an ordered list the
    // group routes, so the order they were stored in is the meaning.
    if (stored.length > 0) {
      return stored.map(entry => this.dataGraphContent(entry.dataGraphVersion));
    }
    if (!testCase.dataGraphVersion) return [];
    return [this.dataGraphContent(testCase.dataGraphVersion)];
  }

  private dataGraphContent(dataGraphVersionId: string): { content: string; format: string } {
    const version = get<LdkitDataGraphVersion>(dataGraphVersionId, 'DataGraphVersion');
    if (!version) {
      throw new TestNotRunnableError(`Data graph version ${dataGraphVersionId} not found`);
    }
    const format = (version.contentFormat || DEFAULT_DATA_GRAPH_FORMAT) as DataGraphFormat;
    return { content: version.contentString ?? '', format: storeManagerFormat(format) };
  }

  /** The executor for the version's named backend. Only reached when one is named. */
  private async resolveExecutor(testVersion: LdkitTestVersion) {
    if (!testVersion.backend) {
      // `withQueryExecutor` decides between backend and data graph and only
      // calls this on the backend branch, so reaching here means those two
      // have drifted apart rather than that the test is missing an input.
      throw new TestNotRunnableError('No backend to run against');
    }
    const node: ResolvedNode = {
      id: `test-backend:${testVersion.backend}`,
      raw: {},
      backendId: testVersion.backend,
      queryVersionId: undefined,
      queryVersion: undefined,
      queryString: undefined,
      queryType: undefined,
      inputTupleIds: [],
      outputTupleIds: [],
    };
    return this.executorFactory.getExecutorForNode(node);
  }
}
