import { describe, it, expect } from 'vitest';
import {
  buildEarlReport,
  earlAssertionInputs,
  outcomeFor,
  MAX_DETAIL_BYTES,
  type EarlAssertionInput,
} from '../../../src/lib/reportFormats/earl.js';
import { NOT_RUN_CASE_NAME } from '../../../src/lib/reportFormats/rows.js';
import type { TestCaseResult, TestRunResult } from '../../../src/lib/TestRunner.js';

const EARL = 'http://www.w3.org/ns/earl#';
const SQLIB = 'https://sparql-query-lib/';
const DCT = 'http://purl.org/dc/terms/';

function testCase(overrides: Partial<TestCaseResult> = {}): TestCaseResult {
  return {
    caseId: 'urn:sqlib:test-case:1',
    name: 'Case 1',
    position: 0,
    passed: true,
    message: '',
    inputs: { argumentSetVersion: null, dataGraphVersion: null },
    durationMs: 412,
    ...overrides,
  };
}

function result(overrides: Partial<TestRunResult> = {}): TestRunResult {
  const cases = overrides.cases ?? [testCase()];
  const failed = cases.filter(c => !c.passed);
  return {
    testId: 'urn:sqlib:test:1',
    testVersionId: 'urn:sqlib:test-version:1',
    passed: failed.length === 0,
    message: '',
    expectationKind: 'bindings',
    hermetic: true,
    durationMs: 412,
    subjectVersionId: 'urn:sqlib:query-version:7',
    ranAt: '2026-08-14T09:32:11.000Z',
    passedCount: cases.length - failed.length,
    failedCount: failed.length,
    ...overrides,
    cases,
  };
}

/** A one-case run, which is what most of these assertions are about. */
function one(caseOverrides: Partial<TestCaseResult> = {}, runOverrides: Partial<TestRunResult> = {}): EarlAssertionInput {
  const c = testCase(caseOverrides);
  return { result: result({ ...runOverrides, cases: [c] }), testCase: c };
}

/** Objects of a predicate, across the whole report. */
function objects(triples: { predicate: string; object: string }[], predicate: string): string[] {
  return triples.filter(t => t.predicate === `<${predicate}>`).map(t => t.object);
}

describe('buildEarlReport', () => {
  it('asserts the criterion, the resolved subject and the outcome', () => {
    const { triples } = buildEarlReport([one()]);

    expect(objects(triples, `${EARL}test`)).toEqual(['<urn:sqlib:test-case:1>']);
    expect(objects(triples, `${EARL}subject`)).toEqual(['<urn:sqlib:query-version:7>']);
    expect(objects(triples, `${EARL}outcome`)).toEqual([`<${EARL}passed>`]);
    expect(objects(triples, `${EARL}mode`)).toEqual([`<${EARL}automatic>`]);
  });

  it('names the case as the criterion, and the version in its own term', () => {
    // An expectation only means anything alongside the inputs it was written
    // against, and it is the case that pairs the two. A version pins several,
    // so citing it would give one criterion several outcomes — the collapse
    // `earl:test` exists to prevent.
    const { triples } = buildEarlReport([one()]);

    expect(objects(triples, `${EARL}test`)).toEqual(['<urn:sqlib:test-case:1>']);
    expect(objects(triples, `${SQLIB}testVersion`)).toEqual(['<urn:sqlib:test-version:1>']);
  });

  it('describes the case it cites, so a report reads without the library store', () => {
    // The report lands in whichever backend the caller nominated; the case is
    // defined in another. Without a label there, "something failed" is all a
    // reader gets.
    const { triples } = buildEarlReport([one({ name: 'Berlin', position: 2 })]);

    expect(triples).toContainEqual({
      subject: '<urn:sqlib:test-case:1>',
      predicate: '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>',
      object: `<${EARL}TestCase>`,
    });
    expect(objects(triples, `${DCT}title`)).toEqual(['"Berlin"']);
    expect(objects(triples, `${SQLIB}position`))
      .toEqual(['"2"^^<http://www.w3.org/2001/XMLSchema#integer>']);
  });

  it('links the assertion to its own result node', () => {
    const { triples } = buildEarlReport([one()]);
    const [resultNode] = objects(triples, `${EARL}result`);

    const outcomeTriple = triples.find(t => t.predicate === `<${EARL}outcome>`);
    expect(outcomeTriple?.subject).toBe(resultNode);
  });

  it('maps a failure to earl:failed and carries the message as earl:info', () => {
    const { triples } = buildEarlReport([
      one({ passed: false, message: '3 unexpected rows, 1 missing' }),
    ]);

    expect(objects(triples, `${EARL}outcome`)).toEqual([`<${EARL}failed>`]);
    expect(objects(triples, `${EARL}info`)).toEqual(['"3 unexpected rows, 1 missing"']);
  });

  it('honours an explicit outcome, so a not-runnable test is cantTell not failed', () => {
    // The distinction between "the subject is wrong" and "the test is wrong" is
    // the whole value of the report; collapsing it into `failed` loses it.
    const { triples } = buildEarlReport([
      { ...one({ passed: false }), outcome: 'cantTell' },
    ]);
    expect(objects(triples, `${EARL}outcome`)).toEqual([`<${EARL}cantTell>`]);
  });

  it('omits earl:info when a pass has no message', () => {
    const { triples } = buildEarlReport([one({ message: '' })]);
    expect(objects(triples, `${EARL}info`)).toEqual([]);
  });

  it('emits the benchmark dimensions so verdicts and timings join', () => {
    const input: EarlAssertionInput = {
      ...one({
        inputs: {
          argumentSetVersion: 'urn:sqlib:argument-set-version:2',
          dataGraphVersion: 'urn:sqlib:data-graph-version:3',
        },
      }),
      subject: 'urn:sqlib:query:1',
      inputs: { backend: 'urn:sqlib:backend:4' },
    };
    const { triples } = buildEarlReport([input]);

    expect(objects(triples, `${SQLIB}refSubject`)).toEqual(['<urn:sqlib:query:1>']);
    expect(objects(triples, `${SQLIB}refArgumentSet`)).toEqual(['<urn:sqlib:argument-set-version:2>']);
    expect(objects(triples, `${SQLIB}dataGraphVersion`)).toEqual(['<urn:sqlib:data-graph-version:3>']);
    expect(objects(triples, `${SQLIB}refBackend`)).toEqual(['<urn:sqlib:backend:4>']);
    expect(objects(triples, `${SQLIB}subjectVersion`)).toEqual(['<urn:sqlib:query-version:7>']);
  });

  it('omits dimensions that were not pinned rather than writing empty terms', () => {
    const { triples } = buildEarlReport([{ ...one(), inputs: { backend: null } }]);
    expect(objects(triples, `${SQLIB}refBackend`)).toEqual([]);
    expect(objects(triples, `${SQLIB}refArgumentSet`)).toEqual([]);
  });

  it('records hermetic and duration with the datatypes benchmarks use', () => {
    const { triples } = buildEarlReport([one()]);

    expect(objects(triples, `${SQLIB}hermetic`))
      .toEqual(['"true"^^<http://www.w3.org/2001/XMLSchema#boolean>']);
    // xsd:decimal matches BenchmarkObservation.durationMs, so the two compare
    // without casting.
    expect(objects(triples, `${SQLIB}durationMs`))
      .toEqual(['"412"^^<http://www.w3.org/2001/XMLSchema#decimal>']);
    expect(objects(triples, `${DCT}date`))
      .toEqual(['"2026-08-14T09:32:11.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>']);
  });

  it('serialises the comparator diff as a JSON literal', () => {
    const { triples } = buildEarlReport([
      one({ passed: false, detail: { missing: ['a'], unexpected: ['b'] } }),
    ]);

    const [detail] = objects(triples, `${SQLIB}detail`);
    expect(detail).toBe('"{\\"missing\\":[\\"a\\"],\\"unexpected\\":[\\"b\\"]}"');
  });

  it('caps an unbounded diff rather than writing it whole', () => {
    const huge = { missing: [ 'x'.repeat(MAX_DETAIL_BYTES * 2) ], unexpected: [] };
    const { triples } = buildEarlReport([one({ passed: false, detail: huge })]);

    const [detail] = objects(triples, `${SQLIB}detail`);
    expect(detail).toContain('[truncated at');
    expect(Buffer.byteLength(detail!, 'utf8')).toBeLessThan(MAX_DETAIL_BYTES + 200);
  });

  it('emits one assertor node however many assertions there are', () => {
    const { triples } = buildEarlReport([
      one(),
      one({ caseId: 'urn:sqlib:test-case:2' }, { testVersionId: 'urn:sqlib:test-version:2' }),
    ]);

    expect(objects(triples, `${EARL}assertedBy`)).toHaveLength(2);
    const software = triples.filter(t => t.object === `<${EARL}Software>`);
    expect(software).toHaveLength(1);
  });

  it('gives distinct assertions distinct identity', () => {
    const { triples } = buildEarlReport([one(), one()]);
    const assertionIds = new Set(objects(triples, `${EARL}test`).map((_, i) => i));
    const subjects = new Set(
      triples.filter(t => t.predicate === `<${EARL}result>`).map(t => t.subject),
    );
    expect(subjects.size).toBe(2);
    expect(assertionIds.size).toBe(2);
  });
});

describe('outcomeFor', () => {
  it('reads pass/fail off the result when nothing overrides it', () => {
    expect(outcomeFor(one({ passed: true }))).toBe('passed');
    expect(outcomeFor(one({ passed: false }))).toBe('failed');
    expect(outcomeFor({ ...one({ passed: false }), outcome: 'untested' })).toBe('untested');
  });
});

describe('earlAssertionInputs', () => {
  it('emits one assertion per case, carrying the dimensions of its entry', () => {
    const inputs = earlAssertionInputs({
      suite: 'urn:sqlib:tag:negation',
      entries: [{
        result: result({ cases: [testCase(), testCase({ caseId: 'urn:sqlib:test-case:2', passed: false })] }),
        subject: 'urn:sqlib:query:q1',
        backend: 'urn:sqlib:backend:b1',
      }],
    });

    expect(inputs).toHaveLength(2);
    expect(inputs.map(input => outcomeFor(input))).toEqual(['passed', 'failed']);
    for (const input of inputs) {
      expect(input.subject).toBe('urn:sqlib:query:q1');
      expect(input.inputs).toEqual({ backend: 'urn:sqlib:backend:b1' });
    }
  });

  it('keeps a test that never ran, as cantTell against its version', () => {
    // The same reason `toRows` synthesises a row: a suite that drops its broken
    // members exports as a smaller, greener suite than the one that ran.
    const notRun = result({ cases: [], passed: false, message: 'TestVersion has no subject' });
    const [assertion, ...rest] = earlAssertionInputs({ suite: 's', entries: [{ result: notRun }] });

    expect(rest).toHaveLength(0);
    expect(outcomeFor(assertion!)).toBe('cantTell');
    expect(assertion!.testCase.caseId).toBe(notRun.testVersionId);
    expect(assertion!.testCase.name).toBe(NOT_RUN_CASE_NAME);
    expect(assertion!.testCase.message).toBe('TestVersion has no subject');

    const { triples } = buildEarlReport([assertion!]);
    expect(objects(triples, `${EARL}outcome`)).toEqual([`<${EARL}cantTell>`]);
  });
});
