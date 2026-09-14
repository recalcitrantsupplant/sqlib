/**
 * LDKit Schema for BenchmarkExperimentVersion Entity (Immutable Version)
 *
 * Represents a versioned benchmark configuration.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const BenchmarkExperimentVersionSchema = {
  '@type': sqlib.BenchmarkExperimentVersion,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['BenchmarkExperiment'] },
  },
  version: {
    '@id': sdo.version,
    '@type': xsd.integer,
  },
  immutable: {
    '@id': sqlib.isImmutable,
    '@type': xsd.boolean,
    '@optional': true,
  },
  subjectSpecs: {
    '@id': sqlib.subjectSpecs,
    '@type': xsd.string, // JSON string of BenchmarkSubjectSpec[]
  },
  repeats: {
    '@id': sqlib.repeats,
    '@type': xsd.integer,
    '@optional': true,
  },
  executionStrategy: {
    '@id': sqlib.executionStrategy,
    '@optional': true,
  },
  timeWindow: {
    '@id': sqlib.timeWindow,
    '@type': xsd.duration,
    '@optional': true,
  },
  maxConcurrency: {
    '@id': sqlib.maxConcurrency,
    '@type': xsd.integer,
    '@optional': true,
  },
  warmupRuns: {
    '@id': sqlib.warmupRuns,
    '@type': xsd.integer,
    '@optional': true,
  },
  cooldownMs: {
    '@id': sqlib.cooldownMs,
    '@type': xsd.integer,
    '@optional': true,
  },
  timeoutMs: {
    '@id': sqlib.timeoutMs,
    '@type': xsd.integer,
    '@optional': true,
  },
  retryCount: {
    '@id': sqlib.retryCount,
    '@type': xsd.integer,
    '@optional': true,
  },
  retryDelayMs: {
    '@id': sqlib.retryDelayMs,
    '@type': xsd.integer,
    '@optional': true,
  },
  randomizeOrder: {
    '@id': sqlib.randomizeOrder,
    '@type': xsd.boolean,
    '@optional': true,
  },
  abortOnError: {
    '@id': sqlib.abortOnError,
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

export interface LdkitBenchmarkExperimentVersion {
  $id: string;
  '@type'?: 'BenchmarkExperimentVersion';
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  subjectSpecs: string; // JSON string of BenchmarkSubjectSpec[]
  repeats?: number | null;
  executionStrategy?: string | null;
  timeWindow?: string | null;
  maxConcurrency?: number | null;
  warmupRuns?: number | null;
  cooldownMs?: number | null;
  timeoutMs?: number | null;
  retryCount?: number | null;
  retryDelayMs?: number | null;
  randomizeOrder?: boolean | null;
  abortOnError?: boolean | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
