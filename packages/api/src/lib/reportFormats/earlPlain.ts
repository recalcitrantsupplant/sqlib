/**
 * The conformance profile: EARL and nothing else.
 *
 * `./earl.ts` reports a run the way *we* need it — `earl:` core plus the
 * `sqlib:` dimensions that let one query span verdicts and benchmark timings.
 * That graph is right for the library and wrong for a submission, and not
 * merely by carrying extra terms: its core terms point at the wrong things.
 * `earl:subject` names the *subject version* that ran, and `earl:test` names
 * one of our minted `urn:sqlib:test-case:` ids. A reviewer can resolve neither,
 * and a report generator joining on `earl:test` finds nothing of the manifest
 * it was built to read.
 *
 * So this is a different report over the same run, not a filter of the other:
 *
 * - **`earl:subject` is the implementation.** One `doap:Project` per report,
 *   the same node on every assertion, described well enough — name, release,
 *   repository, homepage — that a reader can obtain the same thing and check
 *   the claim. That description is what `config/earlReport.ts` supplies.
 * - **`earl:test` is the upstream criterion** — the manifest entry IRI, carried
 *   on `Test.criterion` and seeded from the manifests themselves. A test with
 *   no criterion falls back to its own id rather than being dropped: a report
 *   that silently covered fewer tests than were run is the failure mode worth
 *   avoiding, and an unresolvable subject is visible where an absence is not.
 * - **One assertion per criterion.** Ours is per *case*, because a version
 *   pins several. Upstream, a manifest entry is one test with one verdict, and
 *   N assertions against one criterion is what most report generators quietly
 *   mis-count. `collapseOutcome` does the reduction, pessimistically.
 * - **A term whitelist, applied last.** Belt and braces: whatever anyone later
 *   adds to the assertion builders, nothing outside EARL, DOAP, FOAF, Dublin
 *   Core and `rdf:type` reaches a document labelled a conformance report.
 *
 * `earl:cantTell` keeps the meaning it has everywhere else here: a test that
 * *could not run* is not a test that failed, and a submission that reported it
 * as a failure would be claiming a conformance result it never obtained.
 */

import { iri, literal, RDF_TYPE } from '../../persistence/sparqlTerms.js';
import type { SerialisedTriple } from '../../persistence/EntitySerialiser.js';
import { earl, dct, doap, foaf, xsd } from '../../persistence/namespaces.js';
import { getEarlReportConfig, type EarlReportConfig } from '../../config/earlReport.js';
import type { EarlOutcome } from './earl.js';
import { didNotRun, type TestReportEntry, type TestReportInput } from './rows.js';

/**
 * The vocabularies a conformance report may speak.
 *
 * Matched by namespace rather than by term so that adding `doap:audience`
 * tomorrow needs no edit here, while a `sqlib:` predicate cannot arrive by any
 * route at all.
 */
const ALLOWED_NAMESPACES = [earl.$iri, dct.$iri, doap.$iri, foaf.$iri];

/** Cap on `earl:info`, which otherwise carries a whole comparator diff. */
export const MAX_INFO_BYTES = 4 * 1024;

export interface PlainEarlReport {
  /** Grouped as `earl.ts` groups them: subject block first, then one per assertion. */
  units: SerialisedTriple[][];
  triples: SerialisedTriple[];
  /** Tests whose assertion had to cite our own id because they carry no criterion. */
  unmappedTests: string[];
}

/**
 * One test's verdict, over all its cases.
 *
 * Pessimistic on purpose, and in this order: a failure anywhere is a failed
 * criterion; short of that, a case nobody could run means the criterion was not
 * established. Reporting the majority verdict, or the first one, would let a
 * partially-passing parametrised test read upstream as a pass.
 */
export function collapseOutcome(entry: TestReportEntry): EarlOutcome {
  if (didNotRun(entry.result)) return 'cantTell';
  if (entry.result.cases.some(testCase => !testCase.passed)) return 'failed';
  return 'passed';
}

/** Why it failed, in one literal: the failing cases, named, then truncated. */
function infoFor(entry: TestReportEntry): string {
  const { result } = entry;
  if (didNotRun(result)) return result.message;
  const failures = result.cases.filter(testCase => !testCase.passed);
  if (failures.length === 0) return '';
  const detail = failures
    .map(testCase => (testCase.message ? `${testCase.name}: ${testCase.message}` : testCase.name))
    .join('; ');
  const info = failures.length === result.cases.length
    ? detail
    : `${failures.length} of ${result.cases.length} cases failed — ${detail}`;
  if (Buffer.byteLength(info, 'utf8') <= MAX_INFO_BYTES) return info;
  const cut = Buffer.from(info, 'utf8')
    .subarray(0, MAX_INFO_BYTES)
    .toString('utf8')
    .replace(/�$/, '');
  return `${cut}…`;
}

const OUTCOME_IRI: Record<EarlOutcome, string> = {
  passed: earl.passed,
  failed: earl.failed,
  cantTell: earl.cantTell,
  inapplicable: earl.inapplicable,
  untested: earl.untested,
};

/**
 * The subject of every assertion, described as DOAP.
 *
 * Typed `earl:TestSubject` and `earl:Software` as well as `doap:Project`
 * because the three say different things to different readers and a submission
 * is read by all of them: EARL's schema wants a `TestSubject`, the report
 * generators look for a `doap:Project`, and `earl:Software` is what says this
 * subject is a program rather than a document.
 */
function subjectTriples(config: EarlReportConfig): SerialisedTriple[] {
  const { project } = config;
  const s = iri(project.iri);
  const triples: SerialisedTriple[] = [
    { subject: s, predicate: iri(RDF_TYPE), object: iri(doap.Project) },
    { subject: s, predicate: iri(RDF_TYPE), object: iri(earl.TestSubject) },
    { subject: s, predicate: iri(RDF_TYPE), object: iri(earl.Software) },
    { subject: s, predicate: iri(doap.name), object: literal(project.name, null) },
  ];
  if (project.description) {
    triples.push({ subject: s, predicate: iri(doap.description), object: literal(project.description, null) });
  }
  if (project.homepage) {
    triples.push({ subject: s, predicate: iri(doap.homepage), object: iri(project.homepage) });
  }
  if (project.repository) {
    triples.push({ subject: s, predicate: iri(doap.repository), object: iri(project.repository) });
  }
  if (project.downloadPage) {
    triples.push({ subject: s, predicate: iri(doap['download-page']), object: iri(project.downloadPage) });
  }
  for (const language of project.programmingLanguages) {
    triples.push({
      subject: s,
      predicate: iri(doap['programming-language']),
      object: literal(language, null),
    });
  }
  if (project.version) {
    // `dct:hasVersion` as a plain literal rather than a `doap:Version` node:
    // the release has no IRI to hang a node on, and a reader asking "which
    // version passed" wants the string. `doap:revision` says the same thing in
    // the vocabulary a DOAP consumer reads.
    triples.push({ subject: s, predicate: iri(dct.hasVersion), object: literal(project.version, null) });
    triples.push({ subject: s, predicate: iri(doap.revision), object: literal(project.version, null) });
  }
  if (config.assertor.iri !== project.iri) {
    triples.push({ subject: s, predicate: iri(doap.developer), object: iri(config.assertor.iri) });
  }
  return triples;
}

/** The assertor, when it is somebody other than the software itself. */
function assertorTriples(config: EarlReportConfig): SerialisedTriple[] {
  const { assertor, project } = config;
  // The software asserting about itself is already fully described above;
  // repeating it as a second block would only invite the two to disagree.
  if (assertor.iri === project.iri) return [];
  const s = iri(assertor.iri);
  const type = assertor.kind === 'Software' ? earl.Software : foaf[assertor.kind];
  const triples: SerialisedTriple[] = [
    { subject: s, predicate: iri(RDF_TYPE), object: iri(type) },
    { subject: s, predicate: iri(RDF_TYPE), object: iri(earl.Assertor) },
    { subject: s, predicate: iri(foaf.name), object: literal(assertor.name, null) },
  ];
  if (assertor.homepage) {
    triples.push({ subject: s, predicate: iri(foaf.homepage), object: iri(assertor.homepage) });
  }
  return triples;
}

/**
 * The criterion an assertion is about.
 *
 * `Test.criterion` when the test declares one — the manifest entry, which is
 * the whole point — and our own test id when it does not. The second case is
 * reported back to the serialiser rather than swallowed, so a run of tests that
 * are not mapped to any suite says so at the top of the document instead of
 * looking like a submission.
 */
function criterionFor(entry: TestReportEntry): { iri: string; mapped: boolean } {
  const criterion = entry.criterion?.trim();
  // A criterion that will not serialise as an IRI is treated as absent rather
  // than thrown on: the report is the artefact, and one hand-edited test must
  // not take a two-hundred-test submission down with it.
  return criterion && !/[<>"{}|\\^`\s]/.test(criterion)
    ? { iri: criterion, mapped: true }
    : { iri: entry.result.testId, mapped: false };
}

function assertionTriples(
  entry: TestReportEntry,
  config: EarlReportConfig,
  index: number,
): SerialisedTriple[] {
  const criterion = criterionFor(entry);
  // A blank node, not a minted IRI: an assertion is only ever spoken about by
  // the report that contains it, and a `urn:sqlib:assertion:` subject in a
  // conformance document is one more identifier a reviewer cannot resolve.
  const s = `_:assertion${index}`;
  const r = `_:result${index}`;
  const triples: SerialisedTriple[] = [
    { subject: s, predicate: iri(RDF_TYPE), object: iri(earl.Assertion) },
    { subject: s, predicate: iri(earl.assertedBy), object: iri(config.assertor.iri) },
    { subject: s, predicate: iri(earl.subject), object: iri(config.project.iri) },
    { subject: s, predicate: iri(earl.test), object: iri(criterion.iri) },
    { subject: s, predicate: iri(earl.mode), object: iri(earl.automatic) },
    { subject: s, predicate: iri(earl.result), object: r },
    { subject: r, predicate: iri(RDF_TYPE), object: iri(earl.TestResult) },
    { subject: r, predicate: iri(earl.outcome), object: iri(OUTCOME_IRI[collapseOutcome(entry)]) },
    { subject: r, predicate: iri(dct.date), object: literal(entry.result.ranAt, xsd.dateTime) },
  ];
  const info = infoFor(entry);
  if (info) {
    triples.push({ subject: r, predicate: iri(earl.info), object: literal(info, null) });
  }
  return triples;
}

/** Is every term in this triple one a conformance report is allowed to use? */
function isAllowed({ predicate, object }: SerialisedTriple): boolean {
  const predicateIri = predicate.slice(1, -1);
  if (predicateIri !== RDF_TYPE && !ALLOWED_NAMESPACES.some(ns => predicateIri.startsWith(ns))) {
    return false;
  }
  // A stray `sqlib:` *class* would be as wrong as a stray predicate, and it is
  // the one object position whose value comes from a vocabulary at all.
  if (predicateIri !== RDF_TYPE) return true;
  const objectIri = object.startsWith('<') ? object.slice(1, -1) : object;
  return ALLOWED_NAMESPACES.some(ns => objectIri.startsWith(ns));
}

export function buildPlainEarlReport(
  input: TestReportInput,
  config: EarlReportConfig = getEarlReportConfig(),
): PlainEarlReport {
  const unmappedTests: string[] = [];
  const assertions = input.entries.map((entry, index) => {
    if (!criterionFor(entry).mapped) unmappedTests.push(entry.result.testId);
    return assertionTriples(entry, config, index).filter(isAllowed);
  });
  const units = [
    subjectTriples(config).filter(isAllowed),
    assertorTriples(config).filter(isAllowed),
    ...assertions,
  ].filter(unit => unit.length > 0);
  return { units, triples: units.flat(), unmappedTests };
}
