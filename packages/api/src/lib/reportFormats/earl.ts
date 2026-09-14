/**
 * Test verdicts as an EARL graph.
 *
 * The library declares tests; it does not accumulate their results — the same
 * split a source repository has with CI. So a run *emits* a report and hands it
 * straight back to the caller that asked for it, which is why nothing here
 * writes to the library store, why there is no `TestRun` entity, and why this
 * module produces triples rather than sending them anywhere. Serialising them
 * is `./earlTurtle.ts`; delivering them is the run route's `Accept`. See
 * `docs/guides/testing-and-conformance.md`.
 *
 * **Why EARL rather than `sqlib:` terms.** The W3C eval/ harness (#150) reports
 * in EARL already; emitting it here means conformance runs and ordinary library
 * runs produce one graph shape rather than two plus a mapping. It also supplies
 * `earl:cantTell`, which names a distinction the run route already makes: a test
 * that *could not run* is not a test that *failed*, and conflating them is what
 * makes a red dashboard useless.
 *
 * **The dimensions are borrowed from benchmarks on purpose.** `sqlib:refSubject`,
 * `sqlib:refBackend` and `sqlib:refArgumentSet` are the properties
 * `BenchmarkObservationSchema` already uses. Reusing them rather than minting
 * parallel terms is what lets one query span verdicts and timings — "which query
 * versions pass their tests but regressed on p95" — instead of two vocabularies
 * that happen to mean the same thing.
 */

import { mintId } from '../id.js';
import { iri, literal, RDF_TYPE } from '../../persistence/sparqlTerms.js';
import type { SerialisedTriple } from '../../persistence/EntitySerialiser.js';
import { earl, dct, sdo, sqlib, xsd } from '../../persistence/namespaces.js';
import type { TestCaseResult, TestRunResult } from '../TestRunner.js';
import { didNotRun, NOT_RUN_CASE_NAME, type TestReportInput } from './rows.js';

/** The assertor: this software, as one stable node per report. */
const SQLIB_SOFTWARE = 'urn:sqlib:software';

/**
 * Cap on the comparator diff literal.
 *
 * A bindings diff over a large multiset is unbounded, and an unbounded literal
 * is the thing that actually hurts a triplestore. Follows the size-cap approach
 * `DataGraphVersionWriter` takes with `contentString`.
 */
export const MAX_DETAIL_BYTES = 64 * 1024;

export type EarlOutcome = 'passed' | 'failed' | 'cantTell' | 'inapplicable' | 'untested';

const OUTCOME_IRI: Record<EarlOutcome, string> = {
  passed: earl.passed,
  failed: earl.failed,
  cantTell: earl.cantTell,
  inapplicable: earl.inapplicable,
  untested: earl.untested,
};

/**
 * One case's verdict, plus the context the verdict alone does not carry.
 *
 * An assertion is per *case*, not per run: a version pins several cases, each
 * with its own inputs and its own outcome, and N outcomes citing one criterion
 * is exactly the collapse `earl:test` exists to prevent. What is common to the
 * run — when it happened, what kind of expectation, whether it was hermetic —
 * is repeated onto each assertion, because an assertion has to stand alone.
 *
 * `TestRunResult` deliberately reports what the *run* found; the dimensions
 * shared by every case (the subject, the backend) live on the `Test` and its
 * `TestVersion`. The caller joins them rather than this module reaching into
 * the cache, so the serialiser stays a pure function of its input and the tests
 * need no fixtures.
 */
export interface EarlAssertionInput {
  result: TestRunResult;
  /** The case this assertion is about — the criterion `earl:test` names. */
  testCase: TestCaseResult;
  /** `Test.subject` — the callable under test, matching benchmark `refSubject`. */
  subject?: string | null;
  /** The dimensions the `TestVersion` fixes for every one of its cases. */
  inputs?: {
    backend?: string | null;
  } | null;
  /**
   * Overrides the pass/fail read off the case. The run route cannot produce
   * anything else today — a test that cannot run is a 400 — but a suite run
   * records it as `cantTell` and carries on.
   */
  outcome?: EarlOutcome;
}

export interface EarlReport {
  /**
   * Triples grouped into units — the assertor, then one unit per assertion
   * carrying both the assertion and its result node. The grouping is what lets
   * a serialiser keep an assertion and its `earl:result` together rather than
   * scattering them, and it is the unit any future chunking would split on.
   */
  units: SerialisedTriple[][];
  /** Every triple, flattened. Convenience for inspection and assertions in tests. */
  triples: SerialisedTriple[];
}

function truncateDetail(json: string): string {
  if (Buffer.byteLength(json, 'utf8') <= MAX_DETAIL_BYTES) return json;
  // Slice by bytes, then repair: a naive byte slice can cut a multi-byte
  // character in half and produce a lone replacement char in the store.
  const cut = Buffer.from(json, 'utf8')
    .subarray(0, MAX_DETAIL_BYTES)
    .toString('utf8')
    .replace(/�$/, '');
  return `${cut}… [truncated at ${MAX_DETAIL_BYTES} bytes]`;
}

export function outcomeFor({ testCase, outcome }: EarlAssertionInput): EarlOutcome {
  return outcome ?? (testCase.passed ? 'passed' : 'failed');
}

/** The triples for one assertion, including its criterion and result nodes. */
export function assertionTriples(input: EarlAssertionInput): SerialisedTriple[] {
  const { result, testCase, subject, inputs } = input;
  const assertionId = mintId('earlAssertion');
  const resultId = mintId('earlResult');
  const s = iri(assertionId);
  const r = iri(resultId);
  const c = iri(testCase.caseId);

  const triples: SerialisedTriple[] = [
    { subject: s, predicate: iri(RDF_TYPE), object: iri(earl.Assertion) },
    { subject: s, predicate: iri(earl.assertedBy), object: iri(SQLIB_SOFTWARE) },
    { subject: s, predicate: iri(earl.mode), object: iri(earl.automatic) },
    // The criterion is the *case*: it is what carries an expectation together
    // with the inputs that expectation was written against. The version pins
    // several of those, so naming it here would give one criterion N outcomes.
    { subject: s, predicate: iri(earl.test), object: c },
    // Which version the case came from is a separate question, and the one
    // "what broke it" is asked against, so it keeps its own term.
    { subject: s, predicate: iri(sqlib.testVersion), object: iri(result.testVersionId) },
    { subject: s, predicate: iri(earl.result), object: r },
    { subject: s, predicate: iri(dct.date), object: literal(result.ranAt, xsd.dateTime) },
    { subject: s, predicate: iri(sqlib.expectationKind), object: literal(result.expectationKind, null) },
    { subject: s, predicate: iri(sqlib.hermetic), object: literal(result.hermetic ? 'true' : 'false', xsd.boolean) },
    // The case's own duration, not the run's: a per-case assertion carrying the
    // whole run's time would report the same number N times and mean none of
    // them. xsd:decimal to match BenchmarkObservation.durationMs — same
    // dimension, same datatype, so a query can compare them without casting.
    { subject: s, predicate: iri(sqlib.durationMs), object: literal(String(testCase.durationMs), xsd.decimal) },
    // The criterion described in the report graph itself. The library store the
    // case is defined in is a different backend, so without this a reader can
    // see that something failed but not which case.
    { subject: c, predicate: iri(RDF_TYPE), object: iri(earl.TestCase) },
    { subject: c, predicate: iri(dct.title), object: literal(testCase.name, null) },
    { subject: c, predicate: iri(sqlib.position), object: literal(String(testCase.position), xsd.integer) },
  ];

  // The resolved subject version — pinned or looked up at run time. This is the
  // field that answers "which version broke it", so it is worth its own term
  // even though `earl:subject` is where a generic EARL reader will look.
  if (result.subjectVersionId) {
    triples.push({ subject: s, predicate: iri(earl.subject), object: iri(result.subjectVersionId) });
    triples.push({ subject: s, predicate: iri(sqlib.subjectVersion), object: iri(result.subjectVersionId) });
  }
  if (subject) {
    triples.push({ subject: s, predicate: iri(sqlib.refSubject), object: iri(subject) });
  }
  // These are the case's, not the version's — parametrising a test is precisely
  // varying them, so reading them off the version would label every assertion
  // with the same inputs and lose what distinguishes the cases.
  if (testCase.inputs.argumentSetVersion) {
    triples.push({ subject: s, predicate: iri(sqlib.refArgumentSet), object: iri(testCase.inputs.argumentSetVersion) });
  }
  /*
   * One triple per graph. A case may supply several — a SHACL validation takes
   * shapes and data as separate inputs (issue #298) — and emitting only the
   * first would record the assertion as having run against half its data.
   * Falls back to the scalar for a verdict built before the list existed.
   */
  const dataGraphVersions = testCase.inputs.dataGraphVersions
    ?? (testCase.inputs.dataGraphVersion ? [testCase.inputs.dataGraphVersion] : []);
  for (const dataGraphVersion of dataGraphVersions) {
    triples.push({ subject: s, predicate: iri(sqlib.dataGraphVersion), object: iri(dataGraphVersion) });
  }
  if (inputs?.backend) {
    triples.push({ subject: s, predicate: iri(sqlib.refBackend), object: iri(inputs.backend) });
  }

  triples.push(
    { subject: r, predicate: iri(RDF_TYPE), object: iri(earl.TestResult) },
    { subject: r, predicate: iri(earl.outcome), object: iri(OUTCOME_IRI[outcomeFor(input)]) },
  );
  if (testCase.message) {
    triples.push({ subject: r, predicate: iri(earl.info), object: literal(testCase.message, null) });
  }
  if (testCase.detail) {
    triples.push({
      subject: r,
      predicate: iri(sqlib.detail),
      object: literal(truncateDetail(JSON.stringify(testCase.detail)), null),
    });
  }

  return triples;
}

/** The assertor node, emitted once per report rather than per assertion. */
function assertorTriples(): SerialisedTriple[] {
  const s = iri(SQLIB_SOFTWARE);
  return [
    { subject: s, predicate: iri(RDF_TYPE), object: iri(earl.Software) },
    { subject: s, predicate: iri(sdo.name), object: literal('sqlib', null) },
  ];
}

/**
 * Builds the report for a run.
 *
 * One assertor node and one unit per assertion. There is no graph name: the
 * report is a document handed back in a response, and naming a graph would be
 * describing a place to put it that no longer exists.
 */
export function buildEarlReport(inputs: EarlAssertionInput[]): EarlReport {
  const units = [assertorTriples(), ...inputs.map(assertionTriples)];
  return { units, triples: units.flat() };
}

/**
 * The assertions a run's report contains, in the order the cases ran.
 *
 * The same flattening `toRows()` performs for the row formats, and it has the
 * same job: a test that produced no cases must still appear. Its assertion
 * names the *version* as the criterion rather than a case, because there is no
 * case to name — which is exactly the fact `earl:cantTell` records. Dropping it
 * instead would export a suite that silently shrank to one that passed.
 */
export function earlAssertionInputs(input: TestReportInput): EarlAssertionInput[] {
  // The callback is annotated rather than inferred: its two branches differ in
  // whether they carry `outcome`, and letting the compiler union them makes the
  // result's assignability depend on how a given TypeScript version orders that
  // union — which is a build that passes on one machine and fails on the next.
  return input.entries.flatMap(({ result, subject, backend }): EarlAssertionInput[] => {
    const inputs = { backend: backend ?? null };
    if (didNotRun(result)) {
      return [{
        result,
        testCase: {
          // The version stands in for the case: an assertion has to name a
          // criterion, and the only one this run got as far as identifying is
          // the version that would not run.
          caseId: result.testVersionId || result.testId,
          name: NOT_RUN_CASE_NAME,
          position: 0,
          passed: false,
          message: result.message,
          inputs: { argumentSetVersion: null, dataGraphVersion: null, dataGraphVersions: [] },
          durationMs: result.durationMs,
        },
        subject,
        inputs,
        outcome: 'cantTell',
      }];
    }
    return result.cases.map(testCase => ({ result, testCase, subject, inputs }));
  });
}
