/**
 * The EARL report, as a Turtle document in the response.
 *
 * EARL is a *response format* like every other one here: `Accept: text/turtle`
 * runs the tests and hands back the graph. It used to be the one format that
 * could not be asked for — it was produced only by nominating a backend and a
 * named graph to write it into, which made the caller arrange storage for an
 * artifact they wanted in their hand, and made "give me my results" the one
 * question the route could not answer. See `docs/guides/testing-and-conformance.md`.
 *
 * Turtle rather than N-Triples because a report is read by people as well as by
 * machines: the subject grouping and the prefixes below are the difference
 * between a diff you can scan and eight hundred repeated IRIs. Every N-Triples
 * document is valid Turtle, so the terms `earl.ts` already builds need no
 * re-escaping — only compacting.
 */

import { RDF_TYPE } from '../../persistence/sparqlTerms.js';
import type { SerialisedTriple } from '../../persistence/EntitySerialiser.js';
import { earl, dct, doap, foaf, sdo, sqlib, xsd } from '../../persistence/namespaces.js';
import { buildEarlReport, earlAssertionInputs } from './earl.js';
import { buildPlainEarlReport } from './earlPlain.js';
import { getEarlReportConfig, DEFAULT_PROJECT_IRI } from '../../config/earlReport.js';
import type { TestReportInput } from './rows.js';

const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

/**
 * The prefixes the document declares.
 *
 * Only vocabularies the report actually uses. A minted `urn:sqlib:…` subject is
 * deliberately not compacted: those are opaque identities, and a prefix over
 * them would suggest a namespace that means something.
 */
const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['rdf', RDF_NS],
  ['earl', earl.$iri],
  ['dct', dct.$iri],
  ['sdo', sdo.$iri],
  ['sqlib', sqlib.$iri],
  ['xsd', xsd.$iri],
];

/**
 * The conformance profile's prefixes: the vocabularies it is allowed to use.
 *
 * Deliberately *not* a superset of the list above. Declaring `sqlib:` in a
 * document that must not contain a `sqlib:` term would advertise the thing the
 * profile exists to exclude, and a reviewer reading the header is entitled to
 * take the prefix list as a claim about the contents.
 */
const PLAIN_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['rdf', RDF_NS],
  ['earl', earl.$iri],
  ['doap', doap.$iri],
  ['foaf', foaf.$iri],
  ['dct', dct.$iri],
  ['xsd', xsd.$iri],
];

/**
 * A local name safe to write after a prefix without escaping.
 *
 * Deliberately stricter than Turtle's `PN_LOCAL`: every term in the
 * vocabularies above is a plain word, and a conservative test that falls back
 * to the full IRI cannot emit a document that fails to parse.
 */
const SAFE_LOCAL = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** `<http://…#passed>` → `earl:passed`, when that is safe. Otherwise unchanged. */
function compactIri(term: string, prefixes: ReadonlyArray<readonly [string, string]>): string {
  if (!term.startsWith('<') || !term.endsWith('>')) return term;
  const value = term.slice(1, -1);
  for (const [prefix, namespace] of prefixes) {
    if (!value.startsWith(namespace)) continue;
    const local = value.slice(namespace.length);
    if (SAFE_LOCAL.test(local)) return `${prefix}:${local}`;
  }
  return term;
}

/** Compacts a datatype IRI inside a literal, leaving the lexical form alone. */
function compactTerm(term: string, prefixes: ReadonlyArray<readonly [string, string]>): string {
  const datatype = term.lastIndexOf('^^<');
  if (datatype === -1) return compactIri(term, prefixes);
  return `${term.slice(0, datatype + 2)}${compactIri(term.slice(datatype + 2), prefixes)}`;
}

/** Turtle's `a` for `rdf:type`, which is what a reader expects to see. */
function compactPredicate(term: string, prefixes: ReadonlyArray<readonly [string, string]>): string {
  return term === `<${RDF_TYPE}>` ? 'a' : compactTerm(term, prefixes);
}

/**
 * One block per subject, in the order the triples were built.
 *
 * Order is not cosmetic here: `earl.ts` emits an assertion and the result node
 * it points at as one unit, so keeping insertion order keeps them adjacent in
 * the document rather than separated by the rest of the run.
 */
function toBlocks(
  triples: SerialisedTriple[],
  prefixes: ReadonlyArray<readonly [string, string]> = PREFIXES,
): string[] {
  const bySubject = new Map<string, Map<string, string[]>>();
  for (const { subject, predicate, object } of triples) {
    const byPredicate = bySubject.get(subject) ?? new Map<string, string[]>();
    const key = compactPredicate(predicate, prefixes);
    // Repeated predicates collapse into one object list — `a doap:Project,
    // earl:TestSubject` rather than the same predicate written three times.
    // Both parse; only one reads like a description of a thing.
    byPredicate.set(key, [...(byPredicate.get(key) ?? []), compactTerm(object, prefixes)]);
    bySubject.set(subject, byPredicate);
  }
  return [...bySubject].map(([subject, byPredicate]) => {
    const lines = [...byPredicate].map(([predicate, objects]) =>
      `    ${predicate} ${objects.join(', ')}`);
    return `${compactIri(subject, prefixes)}\n${lines.join(' ;\n')} .`;
  });
}

/** `#` comments are single-line, and a suite name is not guaranteed to be. */
function commentSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function toEarlTurtle(input: TestReportInput): string {
  const { triples } = buildEarlReport(earlAssertionInputs(input));
  const header = [
    `# EARL 1.0 test report — ${commentSafe(input.suite)}`,
    // Not a triple: the report describes assertions, and a run has no identity
    // of its own to hang metadata on now that it is not written anywhere.
    `# ${triples.length} triples, ${input.entries.length} test(s)`,
  ];
  const prefixes = PREFIXES.map(([prefix, namespace]) => `@prefix ${prefix}: <${namespace}> .`);
  return `${[...header, '', ...prefixes, '', ...toBlocks(triples)].join('\n')}\n`;
}

/**
 * The same run as a conformance report: EARL, DOAP and FOAF, nothing of ours.
 *
 * The header comments are the only place a caveat can live. A document
 * describing a placeholder subject, or citing our own ids because the tests
 * declare no criterion, is not a submission — and saying so at the top is
 * cheaper for everyone than a reviewer working it out from an unresolvable
 * IRI. Comments rather than triples because they are notes about the *report*,
 * and a submission's graph should contain assertions and the things they are
 * about.
 */
export function toPlainEarlTurtle(input: TestReportInput): string {
  const config = getEarlReportConfig();
  const { triples, unmappedTests } = buildPlainEarlReport(input, config);
  const header = [
    `# EARL 1.0 conformance report — ${commentSafe(input.suite)}`,
    `# ${input.entries.length} assertion(s), one per test`,
    `# Subject: ${config.project.name}${config.project.version ? ` ${config.project.version}` : ''}`
      + ` <${config.project.iri}>`,
  ];
  if (config.isPlaceholder) {
    header.push(
      '#',
      `# NOT READY TO SUBMIT: the subject is the built-in placeholder <${DEFAULT_PROJECT_IRI}>,`,
      '# which does not resolve. Fill in "earlReport" in packages/api/package.json — its',
      '# projectIri and assertor — along with the npm homepage, repository and author fields.',
      '# See docs/guides/testing-and-conformance.md.',
    );
  }
  if (unmappedTests.length > 0) {
    header.push(
      '#',
      `# ${unmappedTests.length} of ${input.entries.length} test(s) declare no external criterion,`,
      '# so their earl:test cites this library\'s own test IRI, which is meaningless outside it.',
      `# First: <${unmappedTests[0]}>`,
    );
  }
  const prefixes = PLAIN_PREFIXES.map(([prefix, namespace]) => `@prefix ${prefix}: <${namespace}> .`);
  // Blank lines between blocks, unlike the extended report: this is the one
  // document written to be read by someone who has never seen the others.
  const blocks = toBlocks(triples, PLAIN_PREFIXES).join('\n\n');
  return `${[...header, '', ...prefixes, '', blocks].join('\n')}\n`;
}
