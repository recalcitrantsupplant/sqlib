/**
 * Comparing what a callable produced against what a test expected.
 *
 * One interface, three implementations, keyed by **ResultKind rather than
 * entity type**. That is the design's central claim and it is worth stating
 * plainly: a CONSTRUCT query and a rule set both produce a graph and are
 * compared identically; a SELECT query and a query group that ends in one both
 * produce bindings. The callables layer in the web app already collapses query
 * and group by result kind (`web/src/lib/callables.ts`); this does the same on
 * the server, so there is no per-entity comparison logic to keep in step.
 *
 * The graph comparator is the one the W3C eval harness needs too (issue #150):
 * `mf:result` versus the inference graph, isomorphic up to blank-node labels.
 * It is written here rather than in that harness so the two cannot disagree
 * about what "the same graph" means.
 *
 * A comparator never throws on a mismatch. A failing test is data — a verdict
 * with a reason a human can read — not an exception, because a test run reports
 * many results and one failure must not end the run.
 */

import { canonicalizeNQuads } from './rdfCanonicalizer.js';
import { isSrlCheck, SRL_CHECKS, type SrlCheckVerdict } from './srlChecks.js';

export const EXPECTATION_KINDS = ['bindings', 'boolean', 'graph', 'analysis', 'smoke'] as const;

export type ExpectationKind = (typeof EXPECTATION_KINDS)[number];

export function isExpectationKind(value: unknown): value is ExpectationKind {
  return typeof value === 'string' && (EXPECTATION_KINDS as readonly string[]).includes(value);
}

export interface ComparisonResult {
  passed: boolean;
  /** One line a human can act on. Empty when the comparison passed. */
  message: string;
  /** Set only when the two differ and the difference is worth spelling out. */
  detail?: {
    missing?: string[];
    unexpected?: string[];
    /**
     * How many were on both sides.
     *
     * A count rather than the lines themselves: the useful fact about a failed
     * comparison is which items sit on *one* side only, and shipping every
     * matched triple would put whole graphs in a run response to say nothing.
     * The count is what makes "1 missing" legible — 1 of 9 is a typo, 1 of 1 is
     * a broken rule.
     */
    matched?: number;
  };
}

const PASSED: ComparisonResult = { passed: true, message: '' };

/** A SPARQL JSON results document, as far as comparison cares. */
interface BindingsDocument {
  head?: { vars?: string[] };
  results?: { bindings?: Array<Record<string, unknown>> };
  boolean?: boolean;
}

/**
 * One binding row, rendered to a canonical string.
 *
 * Keys are sorted so that `{a, b}` and `{b, a}` are the same row — the SPARQL
 * results format makes no promise about key order, and a comparison that
 * depended on it would fail for reasons that have nothing to do with the query.
 * An unbound variable is simply an absent key, which is how the format
 * represents it, so it needs no special case.
 */
function rowKey(row: Record<string, unknown>): string {
  const entries = Object.entries(row)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([variable, value]) => {
      const term = value as { type?: string; value?: string; datatype?: string; 'xml:lang'?: string };
      const parts = [term.type ?? '', term.value ?? ''];
      if (term.datatype) parts.push(`^^${term.datatype}`);
      if (term['xml:lang']) parts.push(`@${term['xml:lang']}`);
      return `${variable}=${parts.join('|')}`;
    })
    .sort();
  return entries.join('');
}

function readBindings(document: unknown): Array<Record<string, unknown>> | null {
  if (!document || typeof document !== 'object') return null;
  const bindings = (document as BindingsDocument).results?.bindings;
  return Array.isArray(bindings) ? bindings : null;
}

/**
 * Compare solution multisets.
 *
 * A **multiset**, not a set: SPARQL results carry duplicate rows and dropping
 * them would let a query that returns a row twice pass a test expecting it
 * once. Counting rather than set-differencing is what keeps that honest.
 *
 * `ordered` comes from the test rather than from re-reading the query's ORDER
 * BY, so adding an ORDER BY to a subject cannot silently tighten an expectation
 * that was written without one.
 */
export function compareBindings(
  actualDocument: unknown,
  expectedDocument: unknown,
  options: { ordered?: boolean } = {},
): ComparisonResult {
  const actual = readBindings(actualDocument);
  const expected = readBindings(expectedDocument);

  if (!expected) {
    return { passed: false, message: 'Expected result is not a SPARQL JSON results document' };
  }
  if (!actual) {
    return { passed: false, message: 'Subject did not return a SPARQL JSON results document' };
  }

  if (options.ordered) {
    if (actual.length !== expected.length) {
      return {
        passed: false,
        message: `Expected ${expected.length} ordered rows, got ${actual.length}`,
      };
    }
    for (let index = 0; index < expected.length; index += 1) {
      if (rowKey(actual[index]) !== rowKey(expected[index])) {
        return {
          passed: false,
          message: `Row ${index + 1} differs from the expected ordering`,
          detail: { missing: [rowKey(expected[index])], unexpected: [rowKey(actual[index])] },
        };
      }
    }
    return PASSED;
  }

  const counts = new Map<string, number>();
  for (const row of expected) {
    const key = rowKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const unexpected: string[] = [];
  for (const row of actual) {
    const key = rowKey(row);
    const remaining = counts.get(key) ?? 0;
    if (remaining === 0) {
      unexpected.push(key);
    } else if (remaining === 1) {
      counts.delete(key);
    } else {
      counts.set(key, remaining - 1);
    }
  }
  const missing = [...counts.entries()].flatMap(([key, count]) => Array<string>(count).fill(key));

  if (missing.length === 0 && unexpected.length === 0) return PASSED;
  return {
    passed: false,
    message: `Solutions differ: ${missing.length} missing, ${unexpected.length} unexpected`,
    detail: { missing, unexpected, matched: actual.length - unexpected.length },
  };
}

/** Compare an ASK result. */
export function compareBoolean(actual: unknown, expected: unknown): ComparisonResult {
  const actualValue = typeof actual === 'boolean'
    ? actual
    : (actual as BindingsDocument | null)?.boolean;
  const expectedValue = typeof expected === 'boolean'
    ? expected
    : (expected as BindingsDocument | null)?.boolean;

  if (typeof expectedValue !== 'boolean') {
    return { passed: false, message: 'Expected result is not a boolean' };
  }
  if (typeof actualValue !== 'boolean') {
    return { passed: false, message: 'Subject did not return a boolean' };
  }
  return actualValue === expectedValue
    ? PASSED
    : { passed: false, message: `Expected ${expectedValue}, got ${actualValue}` };
}

/**
 * Compare graphs up to blank-node relabelling.
 *
 * Isomorphism, not string equality: a rule that mints blank nodes produces
 * different labels on every run, and a test that compared labels would fail on
 * its second run for no reason anyone could act on. Canonicalisation (URDNA2015
 * via the existing canonicalizer) reduces isomorphism to string equality of the
 * canonical forms, which is both correct and cheap enough to do per test.
 *
 * The line-level diff is computed on the canonical forms, so "missing" and
 * "unexpected" are reported in terms the reader can look up in either graph.
 */
export async function compareGraphs(actualNQuads: string, expectedNQuads: string): Promise<ComparisonResult> {
  let actualCanonical: string;
  let expectedCanonical: string;
  try {
    expectedCanonical = await canonicalizeNQuads(expectedNQuads ?? '');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { passed: false, message: `Expected graph could not be parsed: ${message}` };
  }
  try {
    actualCanonical = await canonicalizeNQuads(actualNQuads ?? '');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { passed: false, message: `Result graph could not be parsed: ${message}` };
  }

  if (actualCanonical === expectedCanonical) return PASSED;

  const actualLines = new Set(actualCanonical.split('\n').filter(Boolean));
  const expectedLines = new Set(expectedCanonical.split('\n').filter(Boolean));
  const missing = [...expectedLines].filter(line => !actualLines.has(line));
  const unexpected = [...actualLines].filter(line => !expectedLines.has(line));

  return {
    passed: false,
    message: `Graphs are not isomorphic: ${missing.length} missing, ${unexpected.length} unexpected`,
    detail: { missing, unexpected, matched: expectedLines.size - missing.length },
  };
}

/**
 * Compare what a check said about a document with what the test expected it to
 * say.
 *
 * The odd one out among the comparators, and worth being explicit about why:
 * the other three compare a subject's *output*, this one compares a judgement
 * about the subject itself. It exists because more than half of the W3C rules
 * suite asserts exactly that — "this document must be rejected" — and a
 * document that must be rejected has no output to compare. Being a separate
 * expectation kind rather than a special graph is what keeps "we reject this,
 * correctly" from reading as "we produced nothing, wrongly".
 *
 * `expected` names the check as well as the verdict, because "accepted" alone
 * is three different claims: parses, is well-formed, stratifies. A test that
 * did not say which would silently start asserting something else the day the
 * runner's default changed.
 */
export function compareAnalysis(actual: SrlCheckVerdict, expectedJson: string): ComparisonResult {
  let expected: unknown;
  try {
    expected = JSON.parse(expectedJson);
  } catch {
    return { passed: false, message: 'Expected analysis is not valid JSON' };
  }

  const { check, accepted } = (expected ?? {}) as { check?: unknown; accepted?: unknown };
  if (!isSrlCheck(check) || typeof accepted !== 'boolean') {
    return {
      passed: false,
      message: `An analysis expectation needs {"check": "${SRL_CHECKS.join('" | "')}", "accepted": true | false}`,
    };
  }
  if (check !== actual.check) {
    return { passed: false, message: `Expected the ${check} check, but the ${actual.check} check was run` };
  }
  if (actual.accepted === accepted) return PASSED;

  return accepted
    // The reason is the whole value of this direction: "we expected this to be
    // accepted and it was not" is only actionable with the parser's complaint
    // attached.
    ? { passed: false, message: `Expected the ${check} check to accept the document, but it was rejected: ${actual.reason}` }
    : { passed: false, message: `Expected the ${check} check to reject the document, but it was accepted` };
}

/**
 * A smoke test's verdict.
 *
 * `expected: null` means "runs, converges, does not error" — the invocation
 * already decided that, so there is nothing left to compare. It exists as a
 * comparator so the runner has one shape to call, rather than a branch that
 * skips comparison and a reader who has to work out why.
 */
export function compareSmoke(): ComparisonResult {
  return PASSED;
}
