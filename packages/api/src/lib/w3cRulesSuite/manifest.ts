/**
 * Reading the W3C SPARQL-RL test manifests.
 *
 * The suite is vendored at a pinned commit under `packages/srl/test/w3c` and
 * has two manifest shapes, because it asks two kinds of question.
 *
 * `eval/`, `eval2/` and `examples/` ask what a rule set *produces*: an entry is
 * a rule set, a data graph and an expected result graph — a subject, an input
 * and an expectation, which is exactly a `Test`. Three directories, one shape:
 * upstream splits them by how settled the tests are, not by what they mean.
 *
 * `syntax/`, `wellformed/` and `stratification/` ask what a document *is*: an
 * entry is one file plus a type that says whether the check should accept or
 * reject it. Also a Test, but of the `analysis` kind — no execution, because
 * a third of these documents are supposed to be unparseable.
 *
 * This module reads files and nothing else. Turning entries into library
 * entities is `seed.ts`; judging them is the ordinary test runner.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as oxigraph from 'oxigraph';
import { getEarlReportConfig } from '../../config/earlReport.js';

const MF = 'http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#';
/**
 * The suite's own test vocabulary.
 *
 * Renamed from `.../ns/shacl-rules-test#` when the language became SPARQL-RL
 * (w3c/data-shapes#1175, which also moved the files from `tests/rules/` to
 * `tests/sparql-rl/`). Only the namespace moved: the local names — the test
 * classes and `ruleset` / `data` — are the same, so nothing else here changes.
 * The manifests' own prefix label for it later went from `srt:` to `srlt:`,
 * which this reader never sees: it resolves the Turtle and matches on the IRI.
 * One IRI, not a list of accepted spellings: the vendored snapshot is
 * a single pinned commit, so exactly one of them can be right at a time, and a
 * reader that silently accepted the old one would go on finding zero entries
 * without saying so.
 */
const SRT = 'http://www.w3.org/ns/sparql-rl-tests#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

/**
 * The base a category's manifest is resolved against.
 *
 * It used to be immaterial — a placeholder, because only the last path segment
 * of a file IRI was ever read back out. It stopped being immaterial when the
 * EARL conformance profile started citing manifest entries: `syntax/` writes
 * `PREFIX : <manifest#>`, so `:test_1` *is* a relative IRI and its resolved
 * value is the criterion a reviewer looks up. Resolving against the location
 * the snapshot was published at makes that value the real one;
 * `eval/manifest.ttl`, whose entries carry an absolute prefix already, is
 * unaffected either way.
 *
 * Configurable through `SQLIB_EARL_SUITE_BASE_IRI` because a fork republishing
 * the suite elsewhere has different criterion IRIs and the same files. See
 * `config/earlReport.ts`.
 */
function manifestBase(category: string): string {
  return `${getEarlReportConfig().suiteBaseIri}${category}/manifest.ttl`;
}

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))); // packages/api

/**
 * The vendored suite, as seen from `packages/api`.
 *
 * A monorepo path, and deliberately so: this is the snapshot the srl package
 * pins and refreshes, and a second copy would be a second thing to keep in
 * step. A deployment that ships `packages/api` alone points
 * `W3C_RULES_SUITE_DIR` at wherever it put the files, and a deployment that
 * ships neither simply never asks for the suite.
 */
const DEFAULT_SUITE_DIR = path.resolve(PACKAGE_ROOT, '../srl/test/w3c');

export function resolveSuiteDir(override?: string): string {
  const target = override ?? process.env.W3C_RULES_SUITE_DIR ?? DEFAULT_SUITE_DIR;
  return path.isAbsolute(target) ? target : path.resolve(PACKAGE_ROOT, target);
}

export class W3cRulesSuiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'W3cRulesSuiteError';
  }
}

/**
 * The three document categories, and the check each one asserts.
 *
 * The directory name *is* the check: `wellformed/` holds the well-formedness
 * tests. Keeping them the same string is what stops a manifest being read into
 * the wrong assertion.
 */
export const DOCUMENT_CATEGORIES = ['syntax', 'wellformed', 'stratification'] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/**
 * The categories whose entries run a rule set against a data graph.
 *
 * Listed rather than discovered by reading `manifest-sparql-rl.ttl`, so that a
 * refreshed snapshot growing a seventh directory shows up as a diff someone
 * looks at instead of silently changing what CI scores.
 */
export const EVAL_CATEGORIES = ['eval', 'eval2', 'examples'] as const;

export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export interface W3cRulesDocumentEntry {
  /** `<category>-<file stem>`, e.g. `syntax-syntax-data-01`. Ids derive from it. */
  slug: string;
  /**
   * The entry's IRI in the manifest, resolved against where the suite is
   * published. `Test.criterion`, and `earl:test` in a conformance report.
   */
  criterion: string;
  /** `mf:name`, which in these manifests is the file name. */
  name: string;
  category: DocumentCategory;
  /**
   * Whether the check should *accept* the document.
   *
   * From the entry's `rdf:type` — `RulesPositiveSyntaxTest` versus
   * `RulesNegative…`. The negative half is the reason these are `analysis`
   * tests rather than smoke tests: 30 of these documents must not parse.
   */
  accepted: boolean;
  file: string;
  document: string;
}

export interface W3cRulesEvalEntry {
  /** `<category>-<manifest IRI local name>`, e.g. `eval-eval-basic-01`. Ids derive from it. */
  slug: string;
  /**
   * The entry's IRI in the manifest, resolved against where the suite is
   * published. `Test.criterion`, and `earl:test` in a conformance report.
   */
  criterion: string;
  category: EvalCategory;
  /** `mf:name`, e.g. `Eval-basic-01`. What a reader sees in a listing. */
  name: string;
  /** `ruleset` — the `.srl` document under test. */
  rulesetFile: string;
  ruleset: string;
  /** `data` — the base graph G0 the rules run against. */
  dataFile: string;
  data: string;
  /**
   * `mf:result` — the **inference graph**, not the union of it with the data.
   * `eval-basic-01-results.ttl` spells the distinction out in comments: the
   * output graph is `:s :p :o` plus `:x :q :o`, and the file holds only the
   * second. That is what our executor returns, so the two line up without any
   * subtraction here.
   */
  resultFile: string;
  result: string;
}

export interface W3cRulesEvalSuite {
  dir: string;
  entries: W3cRulesEvalEntry[];
}

export interface W3cRulesDocumentSuite {
  dir: string;
  entries: W3cRulesDocumentEntry[];
}

/** Is the suite present? Callers that only *optionally* want it ask first. */
export async function suiteExists(dir = resolveSuiteDir()): Promise<boolean> {
  try {
    await fs.access(path.join(dir, 'eval', 'manifest.ttl'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read one document category's manifest and every file it names.
 *
 * The three categories share a manifest shape — `rdf:type` + `mf:name` +
 * `mf:action` — so one reader serves all three, with the check coming from the
 * directory and the polarity from the type.
 */
export async function readW3cRulesDocumentSuite(
  category: DocumentCategory,
  dirOverride?: string,
): Promise<W3cRulesDocumentSuite> {
  const dir = path.join(resolveSuiteDir(dirOverride), category);
  const store = await loadManifest(dir, manifestBase(category));

  const entries: W3cRulesDocumentEntry[] = [];
  for (const testIri of listEntryIris(store, entryTypes(category))) {
    const name = literal(store, testIri, `${MF}name`);
    if (!name) {
      throw new W3cRulesSuiteError(`Manifest entry ${testIri.value} is missing mf:name`);
    }
    const type = iri(store, testIri, `${RDF}type`) ?? '';
    const file = fileName(iri(store, testIri, `${MF}action`), testIri.value, 'mf:action');
    entries.push({
      slug: `${category}-${stem(file)}`,
      criterion: testIri.value,
      name,
      category,
      // Positive means the check accepts; negative means it must reject. Read
      // off the type rather than the file name, because `…-bad-04.srl` is a
      // convention and the type is the assertion.
      accepted: type.includes('Positive'),
      file,
      document: await readSuiteFile(dir, file),
    });
  }

  if (entries.length === 0) {
    throw new W3cRulesSuiteError(`No test entries found in ${path.join(dir, 'manifest.ttl')}`);
  }
  return { dir, entries };
}

/** The two `rdf:type`s a category's entries carry, positive and negative. */
function entryTypes(category: DocumentCategory): string[] {
  const noun = category === 'syntax' ? 'Syntax' : category === 'wellformed' ? 'WellFormedness' : 'Stratification';
  return [`${SRT}RulesPositive${noun}Test`, `${SRT}RulesNegative${noun}Test`];
}

function stem(file: string): string {
  return file.replace(/\.[^.]+$/, '');
}

/**
 * Read one eval-shaped category's manifest and every file it names.
 *
 * Entries come back in manifest order — the `mf:entries` RDF collection is
 * walked rather than matched — so a listing built from this reads the way the
 * suite is written (basic, data, negation, rdfs) instead of in whatever order
 * the triple store happens to hold.
 *
 * Walking the collection also settles which entries count. `eval2/manifest.ttl`
 * defines `:eval-assign-01` and then leaves it out of `mf:entries`, naming two
 * files that are not in the directory; matching on `rdf:type` would have picked
 * it up and failed on the missing files.
 */
export async function readW3cRulesEvalSuite(
  category: EvalCategory,
  dirOverride?: string,
): Promise<W3cRulesEvalSuite> {
  const dir = path.join(resolveSuiteDir(dirOverride), category);
  const store = await loadManifest(dir, manifestBase(category));

  const entries: W3cRulesEvalEntry[] = [];
  for (const testIri of listEntryIris(store, [`${SRT}RulesEvalTest`])) {
    const name = literal(store, testIri, `${MF}name`);
    const action = object(store, testIri, `${MF}action`);
    if (!name || !action) {
      throw new W3cRulesSuiteError(`Manifest entry ${testIri.value} is missing mf:name or mf:action`);
    }
    const rulesetFile = fileName(iri(store, action, `${SRT}ruleset`), testIri.value, 'ruleset');
    const dataFile = fileName(iri(store, action, `${SRT}data`), testIri.value, 'data');
    const resultFile = fileName(iri(store, testIri, `${MF}result`), testIri.value, 'mf:result');

    entries.push({
      // Category-qualified, because the three directories are free to reuse a
      // local name and two already reuse file names.
      slug: `${category}-${localName(testIri.value)}`,
      // The manifest's own IRI for the entry, resolved. This is what a
      // conformance report cites — our ids mean nothing to a reviewer.
      criterion: testIri.value,
      category,
      name,
      rulesetFile,
      ruleset: await readSuiteFile(dir, rulesetFile),
      dataFile,
      data: await readSuiteFile(dir, dataFile),
      resultFile,
      result: await readSuiteFile(dir, resultFile),
    });
  }

  if (entries.length === 0) {
    throw new W3cRulesSuiteError(`No RulesEvalTest entries found in ${path.join(dir, 'manifest.ttl')}`);
  }

  return { dir, entries };
}

/** Parse one category's `manifest.ttl` into a store. */
async function loadManifest(dir: string, base: string): Promise<oxigraph.Store> {
  const manifestPath = path.join(dir, 'manifest.ttl');

  let manifestText: string;
  try {
    manifestText = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new W3cRulesSuiteError(
      `Could not read the W3C rules manifest at ${manifestPath}: ${(error as Error).message}`,
    );
  }

  const store = new oxigraph.Store();
  try {
    store.load(manifestText, { format: 'ttl', base_iri: base });
  } catch (error) {
    throw new W3cRulesSuiteError(`Could not parse ${manifestPath}: ${(error as Error).message}`);
  }
  return store;
}

/** Walk `mf:entries`, so manifest order survives the trip through the store. */
function listEntryIris(store: oxigraph.Store, testTypes: string[]): oxigraph.NamedNode[] {
  const manifest = subjectOfType(store, `${MF}Manifest`);
  const head = manifest ? object(store, manifest, `${MF}entries`) : null;
  const found: oxigraph.NamedNode[] = [];

  let node = head;
  // `rdf:nil` terminates; anything else without a `rdf:first` is a malformed
  // list, and stopping is the only sane reading of it.
  while (node && !(node.termType === 'NamedNode' && node.value === `${RDF}nil`)) {
    const first = object(store, node, `${RDF}first`);
    if (first?.termType === 'NamedNode') found.push(first);
    node = object(store, node, `${RDF}rest`);
  }

  if (found.length > 0) return found;

  // No usable collection: fall back to every typed test, in store order. A
  // manifest that lists its entries badly should still run them.
  const fallback: oxigraph.NamedNode[] = [];
  for (const testType of testTypes) {
    for (const quad of store.match(null, oxigraph.namedNode(`${RDF}type`), oxigraph.namedNode(testType))) {
      if (quad.subject.termType === 'NamedNode') fallback.push(quad.subject);
    }
  }
  return fallback;
}

function subjectOfType(store: oxigraph.Store, typeIri: string): oxigraph.NamedNode | null {
  for (const quad of store.match(null, oxigraph.namedNode(`${RDF}type`), oxigraph.namedNode(typeIri))) {
    if (quad.subject.termType === 'NamedNode') return quad.subject;
  }
  return null;
}

function object(store: oxigraph.Store, subject: oxigraph.Term, predicateIri: string): oxigraph.Term | null {
  if (subject.termType !== 'NamedNode' && subject.termType !== 'BlankNode') return null;
  for (const quad of store.match(subject, oxigraph.namedNode(predicateIri), null)) {
    return quad.object;
  }
  return null;
}

function literal(store: oxigraph.Store, subject: oxigraph.Term, predicateIri: string): string | null {
  const term = object(store, subject, predicateIri);
  return term && term.termType === 'Literal' ? term.value : null;
}

function iri(store: oxigraph.Store, subject: oxigraph.Term, predicateIri: string): string | null {
  const term = object(store, subject, predicateIri);
  return term && term.termType === 'NamedNode' ? term.value : null;
}

/**
 * The file an action IRI names.
 *
 * Only the last segment is kept: the manifest's IRIs are relative and resolve
 * against whatever base the parser was given, and every file the suite
 * references sits beside the manifest.
 */
function fileName(value: string | null, testIri: string, predicate: string): string {
  if (!value) {
    throw new W3cRulesSuiteError(`Manifest entry ${testIri} is missing ${predicate}`);
  }
  const segment = value.split('/').pop() ?? '';
  if (!segment) {
    throw new W3cRulesSuiteError(`Manifest entry ${testIri} has an unusable ${predicate}: ${value}`);
  }
  return segment;
}

function localName(iriValue: string): string {
  const hash = iriValue.lastIndexOf('#');
  if (hash >= 0) return iriValue.slice(hash + 1);
  return iriValue.split('/').pop() ?? iriValue;
}

async function readSuiteFile(dir: string, file: string): Promise<string> {
  // The manifest is data, and a file name out of it must not be able to reach
  // outside the suite directory.
  const resolved = path.resolve(dir, file);
  if (path.dirname(resolved) !== path.resolve(dir)) {
    throw new W3cRulesSuiteError(`Manifest names a file outside the suite directory: ${file}`);
  }
  try {
    return await fs.readFile(resolved, 'utf8');
  } catch (error) {
    throw new W3cRulesSuiteError(`Could not read suite file ${file}: ${(error as Error).message}`);
  }
}
