/**
 * LDKit Schema for BenchmarkObservation Entity (subject-level observation).
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, qb, sqlib } from '../namespaces.js';

export const BenchmarkObservationSchema = {
  '@type': sqlib.BenchmarkObservation,
  dataSet: {
    '@id': qb.dataSet,
    '@type': ldkit.IRI,
  },
  subject: {
    '@id': sqlib.refSubject,
    '@type': ldkit.IRI,
  },
  backend: {
    '@id': sqlib.refBackend,
    '@type': ldkit.IRI,
  },
  /*
   * The tabular input this request ran with — the axis member, whatever kind
   * of library object supplies it.
   *
   * An `ArgumentSet` for a query or query-group subject; a `TupleSet` for a
   * rule-set subject, whose tabular input is tuple seeds
   * (`lib/tupleSeedInput.ts`). One pair of columns for one concept: a second
   * `tupleSet` field beside it would mean every reader of "what did this
   * request run with" had to check two places and know which subject kinds
   * populate which.
   */
  argumentSet: {
    '@id': sqlib.refArgumentSet,
    '@type': ldkit.IRI,
  },
  /*
   * The `ArgumentSetVersion` that `argumentSet` resolved to when this
   * observation was taken.
   *
   * A plan names argument *sets*, which float: publishing a new version of one
   * changes what a frozen benchmark version executes. That is deliberate — §4
   * of the design wants sets to be generators eventually, and a generator has
   * no version to pin in a plan — so reproducibility is carried here, on the
   * run, rather than in the plan (issue #246).
   *
   * Optional because the no-arguments sentinel resolves to nothing, and
   * because observations recorded before this field existed have none.
   */
  argumentSetVersion: {
    '@id': sqlib.refArgumentSetVersion,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /*
   * The base graph a rule-set request ran over, and the version it resolved to.
   *
   * Only a rule-set subject has this axis — a query names a backend instead —
   * so both are optional, and absent on every observation a query or a query
   * group produces.
   */
  dataGraph: {
    '@id': sqlib.refDataGraph,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  dataGraphVersion: {
    '@id': sqlib.refDataGraphVersion,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  runIndex: {
    '@id': sqlib.runIndex,
    '@type': xsd.integer,
  },
  durationMs: {
    '@id': sqlib.durationMs,
    '@type': xsd.decimal,
  },
  resultCount: {
    '@id': sqlib.resultCount,
    '@type': xsd.integer,
  },
  success: {
    '@id': sqlib.success,
    '@type': xsd.boolean,
  },
  errorMessage: {
    '@id': sqlib.errorMessage,
    '@optional': true,
  },
  errorType: {
    '@id': sqlib.errorType,
    '@optional': true,
  },
  backendDurationMs: {
    '@id': sqlib.backendDurationMs,
    '@type': xsd.decimal,
    '@optional': true,
  },
  queueDelayMs: {
    '@id': sqlib.queueDelayMs,
    '@type': xsd.decimal,
    '@optional': true,
  },
  timestamp: {
    '@id': sqlib.timestamp,
    '@type': xsd.dateTime,
  },
} as const satisfies Schema;

export interface LdkitBenchmarkObservation {
  $id: string;
  '@type'?: 'BenchmarkObservation';
  dataSet: string;
  subject: string;
  backend: string;
  argumentSet: string;
  argumentSetVersion?: string | null;
  dataGraph?: string | null;
  dataGraphVersion?: string | null;
  runIndex: number;
  durationMs: number;
  resultCount: number;
  success: boolean;
  errorMessage?: string | null;
  errorType?: string | null;
  backendDurationMs?: number | null;
  queueDelayMs?: number | null;
  timestamp: string;
}
