/**
 * LDKit Schema for BenchmarkNodeObservation Entity (node-level observation).
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, qb, sqlib } from '../namespaces.js';

export const BenchmarkNodeObservationSchema = {
  '@type': sqlib.BenchmarkNodeObservation,
  dataSet: {
    '@id': qb.dataSet,
    '@type': ldkit.IRI,
  },
  groupObservation: {
    '@id': sqlib.refGroupObservation,
    '@type': ldkit.IRI,
  },
  node: {
    '@id': sqlib.refNode,
    '@type': ldkit.IRI,
  },
  backend: {
    '@id': sqlib.refBackend,
    '@type': ldkit.IRI,
  },
  runIndex: {
    '@id': sqlib.runIndex,
    '@type': xsd.integer,
  },
  nodeIndex: {
    '@id': sqlib.nodeIndex,
    '@type': xsd.integer,
    '@optional': true,
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
  timestamp: {
    '@id': sqlib.timestamp,
    '@type': xsd.dateTime,
  },
} as const satisfies Schema;

export interface LdkitBenchmarkNodeObservation {
  $id: string;
  '@type'?: 'BenchmarkNodeObservation';
  dataSet: string;
  groupObservation: string;
  node: string;
  backend: string;
  runIndex: number;
  nodeIndex?: number | null;
  durationMs: number;
  resultCount: number;
  success: boolean;
  errorMessage?: string | null;
  errorType?: string | null;
  timestamp: string;
}
