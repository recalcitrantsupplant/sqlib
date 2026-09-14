import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as oxigraph from 'oxigraph';
import { toPlainEarlTurtle } from '../../../src/lib/reportFormats/earlTurtle.js';
import { buildPlainEarlReport, collapseOutcome } from '../../../src/lib/reportFormats/earlPlain.js';
import {
  negotiateReportFormat,
  renderReport,
  TEST_REPORT_MEDIA_TYPES,
} from '../../../src/lib/reportFormats/index.js';
import type { TestReportEntry, TestReportInput } from '../../../src/lib/reportFormats/rows.js';
import type { TestCaseResult, TestRunResult } from '../../../src/lib/TestRunner.js';
import {
  buildEarlReportConfig,
  resetEarlReportConfig,
  DEFAULT_PROJECT_IRI,
  DEFAULT_SUITE_BASE_IRI,
  type PackageManifest,
} from '../../../src/config/earlReport.js';

const EARL = 'http://www.w3.org/ns/earl#';
const DOAP = 'http://usefulinc.com/ns/doap#';
const SQLIB = 'https://sparql-query-lib/';
const TEST_ID = 'urn:sqlib:test:t1';
const CRITERION = 'https://w3c.github.io/rdf-tests/shacl/shacl12/eval-basic-01';

/** The manifest a published project has, so the assertions read as one. */
const SUBMISSION_MANIFEST: PackageManifest = {
  name: '@sparql-query-lib/api',
  version: '0.9.1',
  homepage: 'https://example.org/sqlib',
  repository: { url: 'git+https://example.org/sqlib.git' },
  earlReport: {
    projectName: 'sqlib',
    projectIri: 'https://example.org/sqlib#project',
    assertor: { iri: 'https://example.org/people/dc', name: 'D. Chabgood' },
  },
};

function testCase(overrides: Partial<TestCaseResult> = {}): TestCaseResult {
  return {
    caseId: 'urn:sqlib:test-version:tv1#case-0',
    name: 'Case 1',
    position: 0,
    passed: true,
    message: '',
    inputs: { argumentSetVersion: null, dataGraphVersion: null, dataGraphVersions: [] },
    durationMs: 5,
    ...overrides,
  };
}

function runResult(overrides: Partial<TestRunResult> = {}): TestRunResult {
  return {
    testId: TEST_ID,
    testVersionId: 'urn:sqlib:test-version:tv1',
    passed: true,
    message: '',
    expectationKind: 'graph' as TestRunResult['expectationKind'],
    hermetic: true,
    durationMs: 12,
    subjectVersionId: 'urn:sqlib:ruleset-version:7',
    ranAt: '2026-09-07T09:32:11.000Z',
    cases: [testCase()],
    passedCount: 1,
    failedCount: 0,
    ...overrides,
  };
}

function entry(overrides: Partial<TestReportEntry> = {}): TestReportEntry {
  return {
    result: runResult(),
    subject: 'urn:sqlib:ruleset:r1',
    backend: 'urn:sqlib:backend:b1',
    criterion: CRITERION,
    ...overrides,
  };
}

function input(entries: TestReportEntry[] = [entry()]): TestReportInput {
  return { suite: 'urn:sqlib:tag:conformance', entries };
}

function parse(turtle: string): oxigraph.Store {
  const store = new oxigraph.Store();
  store.load(turtle, { format: 'text/turtle' });
  return store;
}

function objectsOf(store: oxigraph.Store, predicate: string): string[] {
  return store.match(null, oxigraph.namedNode(predicate), null, null).map(quad => quad.object.value);
}

describe('the EARL conformance profile', () => {
  beforeEach(() => resetEarlReportConfig(SUBMISSION_MANIFEST));
  afterEach(() => resetEarlReportConfig());

  it('cites the manifest entry, not our own test or case ids', () => {
    const store = parse(toPlainEarlTurtle(input()));
    expect(objectsOf(store, `${EARL}test`)).toEqual([CRITERION]);
  });

  it('points earl:subject at the implementation, the same node on every assertion', () => {
    const store = parse(toPlainEarlTurtle(input([
      entry(),
      entry({ criterion: `${CRITERION}-2`, result: runResult({ passed: false, cases: [testCase({ passed: false })] }) }),
    ])));

    // Not the subject *version* that ran, which is what the extended report
    // names and what a reviewer cannot resolve.
    expect(new Set(objectsOf(store, `${EARL}subject`)))
      .toEqual(new Set(['https://example.org/sqlib#project']));
    expect(objectsOf(store, `${EARL}assertedBy`))
      .toEqual(['https://example.org/people/dc', 'https://example.org/people/dc']);
  });

  it('describes the subject well enough to obtain it', () => {
    const store = parse(toPlainEarlTurtle(input()));
    expect(objectsOf(store, `${DOAP}name`)).toEqual(['sqlib']);
    expect(objectsOf(store, `${DOAP}homepage`)).toEqual(['https://example.org/sqlib']);
    expect(objectsOf(store, `${DOAP}repository`)).toEqual(['https://example.org/sqlib.git']);
    expect(objectsOf(store, `${DOAP}revision`)).toEqual(['0.9.1']);
  });

  it('contains no sqlib term anywhere — that is the whole point of the profile', () => {
    const turtle = toPlainEarlTurtle(input());
    expect(turtle).not.toContain(SQLIB);
    // Nor a prefix declaring one, which would advertise what the profile excludes.
    expect(turtle).not.toContain('@prefix sqlib:');
    const store = parse(turtle);
    for (const quad of store.match(null, null, null, null)) {
      expect(quad.predicate.value.startsWith(SQLIB)).toBe(false);
      expect(quad.object.value.startsWith(SQLIB)).toBe(false);
    }
  });

  it('emits one assertion per test, and fails a criterion if any case failed', () => {
    const mixed = entry({
      result: runResult({
        passed: false,
        cases: [testCase(), testCase({ caseId: 'c2', name: 'Case 2', passed: false, message: 'row 3 differs' })],
        passedCount: 1,
        failedCount: 1,
      }),
    });
    const store = parse(toPlainEarlTurtle(input([mixed])));

    // The extended report would emit two assertions here, one per case; a
    // manifest entry is one test upstream and gets one verdict.
    expect(store.match(null, null, oxigraph.namedNode(`${EARL}Assertion`), null)).toHaveLength(1);
    expect(objectsOf(store, `${EARL}outcome`)).toEqual([`${EARL}failed`]);
    expect(objectsOf(store, `${EARL}info`)[0]).toContain('row 3 differs');
  });

  it('reports a test that could not run as cantTell, never as a failure', () => {
    const store = parse(toPlainEarlTurtle(input([
      entry({ result: runResult({ passed: false, cases: [], message: 'no version', passedCount: 0, failedCount: 0 }) }),
    ])));
    expect(objectsOf(store, `${EARL}outcome`)).toEqual([`${EARL}cantTell`]);
    expect(objectsOf(store, `${EARL}info`)).toEqual(['no version']);
  });

  it('collapses pessimistically', () => {
    expect(collapseOutcome(entry())).toBe('passed');
    expect(collapseOutcome(entry({ result: runResult({ cases: [testCase(), testCase({ passed: false })] }) })))
      .toBe('failed');
    expect(collapseOutcome(entry({ result: runResult({ cases: [] }) }))).toBe('cantTell');
  });

  it('says in the document when the tests carry no criterion', () => {
    const turtle = toPlainEarlTurtle(input([entry({ criterion: null })]));
    // Still reported — a shrunken report is worse than a caveated one — but
    // citing an id that means nothing outside this library, and saying so.
    expect(turtle).toContain('declare no external criterion');
    expect(buildPlainEarlReport(input([entry({ criterion: null })])).unmappedTests).toEqual([TEST_ID]);
  });

  it('refuses to look like a submission while the subject is the placeholder', () => {
    resetEarlReportConfig({});
    const turtle = toPlainEarlTurtle(input());
    expect(turtle).toContain('NOT READY TO SUBMIT');
    expect(turtle).toContain(DEFAULT_PROJECT_IRI);
    expect(parse(turtle)).toBeDefined();
  });

  it('survives a suite name that would otherwise break the header comment', () => {
    const turtle = toPlainEarlTurtle({ ...input(), suite: 'urn:sqlib:tag:a\nnot a comment' });
    expect(parse(turtle)).toBeDefined();
  });
});

describe('the EARL report configuration', () => {
  it('self-asserts when nobody is named, and names a person when one is', () => {
    const unattended = buildEarlReportConfig({});
    expect(unattended.assertor.iri).toBe(DEFAULT_PROJECT_IRI);
    expect(unattended.assertor.kind).toBe('Software');
    expect(unattended.isPlaceholder).toBe(true);
    expect(unattended.suiteBaseIri).toBe(DEFAULT_SUITE_BASE_IRI);

    const submitted = buildEarlReportConfig(SUBMISSION_MANIFEST);
    expect(submitted.assertor.kind).toBe('Person');
    expect(submitted.isPlaceholder).toBe(false);
  });

  it('takes the release and its description from the npm fields', () => {
    // The point of living in package.json: no second place to bump a version.
    const config = buildEarlReportConfig({
      version: '2.4.0',
      description: 'Fastify backend',
      homepage: 'https://example.org/sqlib',
      repository: 'git+https://example.org/sqlib.git',
    });
    expect(config.project.version).toBe('2.4.0');
    expect(config.project.description).toBe('Fastify backend');
    expect(config.project.homepage).toBe('https://example.org/sqlib');
    // `git+` and `git://` are npm spellings, not IRIs a reviewer can open.
    expect(config.project.repository).toBe('https://example.org/sqlib.git');
  });

  it('reads npm\'s author shorthand as the assertor', () => {
    const config = buildEarlReportConfig({
      author: 'D. Chabgood <dc@example.org> (https://example.org/people/dc)',
    });
    expect(config.assertor.name).toBe('D. Chabgood');
    expect(config.assertor.iri).toBe('https://example.org/people/dc');
    expect(config.assertor.kind).toBe('Person');
  });

  it('drops a field that could not be serialised as an IRI', () => {
    // Better a missing homepage than a 500 on the report route days later.
    const config = buildEarlReportConfig({ ...SUBMISSION_MANIFEST, homepage: 'not an iri' });
    expect(config.project.homepage).toBeUndefined();
    expect(config.project.name).toBe('sqlib');
  });

  it('gives the suite base a trailing slash, so a manifest path concatenates', () => {
    const config = buildEarlReportConfig({ earlReport: { suiteBaseIri: 'https://example.org/tests' } });
    expect(config.suiteBaseIri).toBe('https://example.org/tests/');
  });

  it('reads the shipped manifest, and it is still a placeholder', () => {
    // The report says NOT READY TO SUBMIT until this stops being true, so if
    // the project IRI is ever filled in, this test is the reminder to check the
    // rest of the block with it.
    const shipped = resetEarlReportConfig();
    expect(shipped.project.name).toBe('sqlib');
    expect(shipped.isPlaceholder).toBe(true);
    expect(shipped.suiteBaseIri).toBe(DEFAULT_SUITE_BASE_IRI);
  });
});

describe('negotiating the two EARL reports', () => {
  function formatFor(accept: string) {
    const negotiated = negotiateReportFormat(accept);
    return negotiated.kind === 'format' ? negotiated.format : null;
  }

  it('keeps plain text/turtle meaning the report it has always meant', () => {
    const format = formatFor('text/turtle');
    expect(format?.filename).toBe('test-results.ttl');
    expect(format?.render(input())).toContain('@prefix sqlib:');
  });

  it('answers the conformance profile when it is asked for, by any of its names', () => {
    for (const accept of [
      'text/turtle;profile=earl',
      'text/turtle; profile="w3c"',
      'text/turtle;profile="https://www.w3.org/TR/EARL10-Schema/"',
      'application/x-turtle;profile=earl',
    ]) {
      const format = formatFor(accept);
      expect(format?.filename, accept).toBe('earl-report.ttl');
      expect(format?.mediaType, accept).toBe(TEST_REPORT_MEDIA_TYPES.EARL);
    }
  });

  it('406s a profile nobody offers rather than serving a different graph', () => {
    // The same reason an unknown media type is a 406: a CI step that asked for
    // one document and silently received another looks green while lying.
    expect(negotiateReportFormat('text/turtle;profile=earl-strict').kind).toBe('unacceptable');
  });

  it('says which profile it answered with', () => {
    const format = formatFor('text/turtle;profile=earl')!;
    const rendered = renderReport(format, input());
    expect(rendered.contentType).toBe('text/turtle; charset=utf-8; profile="earl"');
    expect(rendered.contentDisposition).toContain('earl-report.ttl');
  });
});
