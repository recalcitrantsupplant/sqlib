/**
 * LDKit Schema for EtlExecution Entity
 *
 * Records each execution of an ETL job for audit/history.
 *
 * An execution has two possible sinks, and the fields say which one this run
 * used. `outputFormat`/`outputLocation` are the file a SPARQL-loading run
 * wrote (`/etl-jobs/:id/execute`); `outputTupleSetVersion`/`outputReused` are
 * the snapshot a tabular run produced (`/tuple-sets/:id/versions/from-etl`,
 * issue #211). They are separate fields rather than one overloaded pair
 * because `outputLocation` is contractually a path under the ETL output
 * directory — `getExecutionOutput` resolves it and refuses anything outside —
 * so a version IRI stored there would be read as a file that is not one.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib } from '../namespaces.js';

export const EtlExecutionSchema = {
  '@type': sqlib.EtlExecution,
  etlJobVersion: {
    '@id': sqlib.etlJobVersion,
    '@type': ldkit.IRI,
  },
  columnMappingVersion: {
    '@id': sqlib.columnMappingVersion,
    '@type': ldkit.IRI,
  },
  status: {
    '@id': sqlib.executionStatus,
  },
  startedAt: {
    '@id': sqlib.startedAt,
    '@type': xsd.dateTime,
  },
  completedAt: {
    '@id': sqlib.completedAt,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  totalChunks: {
    '@id': sqlib.totalChunks,
    '@type': xsd.integer,
    '@optional': true,
  },
  completedChunks: {
    '@id': sqlib.completedChunks,
    '@type': xsd.integer,
    '@optional': true,
  },
  totalRows: {
    '@id': sqlib.totalRows,
    '@type': xsd.integer,
    '@optional': true,
  },
  errorMessage: {
    '@id': sqlib.errorMessage,
    '@optional': true,
  },
  errorChunk: {
    '@id': sqlib.errorChunk,
    '@type': xsd.integer,
    '@optional': true,
  },
  outputFormat: {
    '@id': sqlib.outputFormat,
    '@optional': true,
  },
  outputLocation: {
    '@id': sqlib.outputLocation,
    '@optional': true,
  },
  outputTupleSetVersion: {
    '@id': sqlib.outputTupleSetVersion,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  outputReused: {
    '@id': sqlib.outputReused,
    '@type': xsd.boolean,
    '@optional': true,
  },
  executionConfig: {
    '@id': sqlib.executionConfig,
    '@optional': true, // JSON string
  },
} as const satisfies Schema;

export type EtlExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial';

export interface LdkitEtlExecution {
  $id: string;
  '@type'?: 'EtlExecution';
  etlJobVersion: string; // IRI to EtlJobVersion
  columnMappingVersion: string; // IRI to EtlColumnMappingVersion
  status: EtlExecutionStatus;
  startedAt: string; // ISO dateTime
  completedAt?: string | null; // ISO dateTime
  totalChunks?: number | null;
  completedChunks?: number | null;
  totalRows?: number | null;
  errorMessage?: string | null;
  errorChunk?: number | null;
  outputFormat?: string | null; // e.g., 'nquads', 'turtle'
  outputLocation?: string | null; // where output was written
  /** The TupleSetVersion a tabular run snapshotted (issue #211). */
  outputTupleSetVersion?: string | null; // IRI to TupleSetVersion
  /**
   * True when that version already existed: the run produced what the current
   * version already held, so nothing new was cut. It is the difference
   * between "it ran at 14:02 and stored a table" and "it ran at 14:02 and
   * produced nothing new", which is the whole reason a run log is not a
   * version chain.
   */
  outputReused?: boolean | null;
  executionConfig?: string | null; // JSON string
}
