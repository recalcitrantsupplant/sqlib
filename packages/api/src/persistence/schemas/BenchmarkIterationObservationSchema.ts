/**
 * LDKit Schema for BenchmarkIterationObservation Entity (iteration-level
 * observation of a rule-set request).
 *
 * The fixpoint loop's counterpart to `BenchmarkNodeObservation`: one row per
 * pass of `RuleSetExecutor`'s loop, hanging off the `BenchmarkObservation` for
 * the request that produced it. A rule-set request is one run to fixpoint, and
 * this is the table that says where inside that run the time went.
 *
 * The difference from a node observation is the identity. A node observation
 * points at a `QueryNode` — a library object that outlives the run, so two runs
 * agree on what "that node" means. An iteration has no such object: it is
 * created by the loop and gone when the loop ends. Its identity is therefore
 * ordinal — `iterationIndex` within the run, `stratum` saying which layer that
 * ordinal belongs to — which is why there is no `refNode` counterpart here.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, qb, sqlib } from '../namespaces.js';

export const BenchmarkIterationObservationSchema = {
  '@type': sqlib.BenchmarkIterationObservation,
  dataSet: {
    '@id': qb.dataSet,
    '@type': ldkit.IRI,
  },
  /**
   * The `BenchmarkObservation` for the request this pass belongs to.
   *
   * Named for the subject rather than the group, unlike
   * `BenchmarkNodeObservation.groupObservation`: the parent of an iteration is
   * a rule-set observation, and there is no group in the story.
   */
  subjectObservation: {
    '@id': sqlib.refSubjectObservation,
    '@type': ldkit.IRI,
  },
  runIndex: {
    '@id': sqlib.runIndex,
    '@type': xsd.integer,
  },
  /** 1-based, and global across strata — the loop counts passes, not layers. */
  iterationIndex: {
    '@id': sqlib.iterationIndex,
    '@type': xsd.integer,
  },
  stratum: {
    '@id': sqlib.stratum,
    '@type': xsd.integer,
    '@optional': true,
  },
  durationMs: {
    '@id': sqlib.durationMs,
    '@type': xsd.decimal,
  },
  /**
   * Triples this pass derived — its delta, not the graph's size.
   *
   * `resultCount` means "what this row produced" everywhere else in the cube,
   * and for a pass of the loop that is the delta. The running total is
   * `tripleCount` beside it.
   */
  resultCount: {
    '@id': sqlib.resultCount,
    '@type': xsd.integer,
  },
  /** Size of the inference graph once this pass finished. */
  tripleCount: {
    '@id': sqlib.tripleCount,
    '@type': xsd.integer,
  },
  /** Rows in the named-tuple workspace once this pass finished. */
  tupleCount: {
    '@id': sqlib.tupleCount,
    '@type': xsd.integer,
    '@optional': true,
  },
  /** Rules evaluated in this pass — the ones in its stratum that were not `once`-spent. */
  rulesEvaluated: {
    '@id': sqlib.rulesEvaluated,
    '@type': xsd.integer,
  },
  timestamp: {
    '@id': sqlib.timestamp,
    '@type': xsd.dateTime,
  },
} as const satisfies Schema;

export interface LdkitBenchmarkIterationObservation {
  $id: string;
  '@type'?: 'BenchmarkIterationObservation';
  dataSet: string;
  subjectObservation: string;
  runIndex: number;
  iterationIndex: number;
  stratum?: number | null;
  durationMs: number;
  resultCount: number;
  tripleCount: number;
  tupleCount?: number | null;
  rulesEvaluated: number;
  timestamp: string;
}
