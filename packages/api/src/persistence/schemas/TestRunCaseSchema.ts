/**
 * Schema for TestRunCase — one case's verdict inside a stored run.
 *
 * A run is judged per case, so a history that stored only the test-level
 * verdict could not answer "which case broke", which is the question a red row
 * is actually asking. These rows are also what lets a stored run be re-rendered
 * as EARL, JUnit or CSV without running anything: every field
 * `reportFormats/rows.ts` flattens is here.
 *
 * **What is deliberately not here: the result text.** A live run response
 * carries what the subject produced, capped at 64 KiB per case
 * (`TestRunner.renderResult`). Keeping that per case per run is what turns a
 * bounded history into an unbounded one — a graph test's result is the whole
 * inferred graph — and no report format reads it. The diff (`detail`) and the
 * message are what a reader of *history* needs; the result is a property of
 * running, and running is a button away.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const TestRunCaseSchema = {
  '@type': sqlib.TestRunCase,
  /** The run this row belongs to. Cases die with their run — see the store. */
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
  },
  /**
   * The `TestCase` judged.
   *
   * A reference, not a containment, and not validated on read: editing a test
   * re-mints its cases, so a run from before an edit cites ids that no longer
   * resolve. Recording what it *was* is the point.
   */
  testCase: {
    '@id': sqlib.refTestCase,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /** The case's label at run time, or `Case N`. Stored, not re-derived. */
  name: {
    '@id': sdo.name,
    '@optional': true,
  },
  position: {
    '@id': sqlib.position,
    '@type': xsd.integer,
    '@optional': true,
  },
  outcome: {
    '@id': sqlib.outcome,
  },
  message: {
    '@id': sqlib.errorMessage,
    '@optional': true,
  },
  /**
   * The comparator diff, as the JSON string the report formats already emit.
   *
   * One string rather than three properties (`missing`, `unexpected`,
   * `matched`) because that is exactly the shape `toRows` puts on a row and
   * `toJUnitXml` puts in a `<failure>` body — storing it decomposed would mean
   * two spellings of one document and a re-assembly step that can disagree.
   */
  detail: {
    '@id': sqlib.detail,
    '@optional': true,
  },
  durationMs: {
    '@id': sqlib.durationMs,
    '@type': xsd.decimal,
    '@optional': true,
  },
  argumentSetVersion: {
    '@id': sqlib.refArgumentSetVersion,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /** The first RDF input — the whole truth for every single-graph case. */
  dataGraphVersion: {
    '@id': sqlib.dataGraphVersion,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /** Every RDF input, for a group case that supplies several (issue #298). */
  dataGraphVersions: {
    '@id': sqlib.dataGraphVersions,
    '@array': true,
    '@type': ldkit.IRI,
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

export interface LdkitTestRunCase {
  $id: string;
  '@type'?: 'TestRunCase';
  isPartOf: string;
  testCase?: string | null;
  name?: string | null;
  position?: number | null;
  outcome: 'passed' | 'failed';
  message?: string | null;
  detail?: string | null;
  durationMs?: number | null;
  argumentSetVersion?: string | null;
  dataGraphVersion?: string | null;
  dataGraphVersions?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
