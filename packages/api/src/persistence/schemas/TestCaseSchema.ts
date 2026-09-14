/**
 * LDKit Schema for TestCase entity.
 *
 * One parametrised case: the inputs, and what is correct *given those inputs*.
 *
 * This is pytest's `@pytest.mark.parametrize`, not its `@pytest.fixture` — the
 * reusable-setup job is DataGraph's. It is also `earl:TestCase`, which is the
 * criterion an `earl:Assertion` cites; two independent vocabularies picking the
 * same word is a good reason to use it.
 *
 * **The expectation lives here rather than on the version, and that is the
 * whole point.** Changing the arguments changes what is correct, so an
 * expectation is only meaningful next to the inputs it was written against. It
 * is also what leaves room for a backend axis later without re-modelling: cells
 * would be cases × backends, each judged against its *case's* expectation, so
 * "every store must satisfy this" stays expressible. Putting the expectation on
 * the cell instead is the choice that would foreclose that.
 *
 * `expectationKind` stays on the version: a subject's ResultKind does not vary
 * by case, and one comparator per test is what makes a row-by-row report
 * readable.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const TestCaseSchema = {
  '@type': sqlib.TestCase,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['TestVersion'] },
  },
  /** 0-based, because RDF arrays carry no order. Same reason as `TupleMember`. */
  position: {
    '@id': sqlib.position,
    '@type': xsd.integer,
  },
  /** Optional label, so a failing case is nameable in a report. */
  name: {
    '@id': sdo.name,
    '@optional': true,
  },
  argumentSetVersion: {
    '@id': sqlib.refArgumentSet,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['ArgumentSetVersion'] },
  },
  /**
   * The single RDF input, for a subject that takes exactly one.
   *
   * Kept beside `dataGraphs` rather than replaced by it. A rule set and a
   * query each run against one store, so for those this *is* the model, and
   * every stored case predates the multi-graph spelling. The runner reads a
   * lone `dataGraphVersion` as the one-element list, so the two never disagree
   * — and `TestVersionWriter` refuses a case that sets both.
   */
  dataGraphVersion: {
    '@id': sqlib.dataGraphVersion,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['DataGraphVersion'] },
  },
  /**
   * The ordered RDF inputs, for a query group that declares several.
   *
   * Ordered children rather than an array of version IRIs, because which graph
   * fills which start-node port is decided by position, and RDF arrays carry
   * no order (issue #298).
   */
  dataGraphs: {
    '@id': sqlib.dataGraphs,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['TestCaseDataGraph'] },
  },
  tupleSeeds: {
    '@id': sqlib.tupleSeeds,
    '@type': xsd.string,
    '@optional': true,
  },
  /**
   * DuckDB statements run before an ETL subject's own SQL — the rows it reads.
   *
   * On the case rather than the version for the reason the expectation is:
   * changing the fixture changes what is correct, so the two only mean anything
   * next to each other. Stored as SQL rather than as a table of values because
   * the ETL sandbox leaves no file for a fixture to live in and because only DDL
   * can state a column's type, which is most of what an ETL job's mapping is
   * about.
   */
  sqlFixture: {
    '@id': sqlib.sqlFixture,
    '@type': xsd.string,
    '@optional': true,
  },
  expected: {
    '@id': sqlib.expected,
    '@type': xsd.string,
    '@optional': true,
  },
  /** The RDF serialisation `expected` is written in, for `graph` expectations. */
  expectedFormat: {
    '@id': sqlib.expectedFormat,
    '@type': xsd.string,
    '@optional': true,
  },
  /**
   * Whether a bindings comparison honours row order. Per case because two cases
   * of one test can legitimately differ — one arguments set may produce an
   * ordered result where another does not.
   */
  ordered: {
    '@id': sqlib.ordered,
    '@type': xsd.boolean,
    '@optional': true,
  },
  dateCreated: {
    '@id': sdo.dateCreated,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  dateModified: {
    '@id': sdo.dateModified,
    '@type': xsd.dateTime,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitTestCase {
  $id: string;
  '@type'?: 'TestCase';
  isPartOf: string;
  position: number;
  name?: string | null;
  argumentSetVersion?: string | null;
  dataGraphVersion?: string | null;
  dataGraphs?: string[] | null;
  tupleSeeds?: string | null;
  sqlFixture?: string | null;
  expected?: string | null;
  expectedFormat?: string | null;
  ordered?: boolean | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
