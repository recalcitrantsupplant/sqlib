/**
 * LDKit Schema for BenchmarkIterationRun Entity (iteration-level dataset).
 *
 * The rule-set counterpart of `BenchmarkNodeRun`. Per-iteration observations
 * have their own data structure definition, so they need their own `qb:DataSet`
 * to hang from rather than sharing the run's — the same reason node
 * observations do not share it. `isPartOf` is what ties both back to the
 * `BenchmarkRun` a reader started from.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, qb, prov, sqlib, sdo } from '../namespaces.js';

export const BenchmarkIterationRunSchema = {
  '@type': sqlib.BenchmarkIterationRun,
  name: {
    '@id': sdo.name,
    '@optional': true,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  structure: {
    '@id': qb.structure,
    '@type': ldkit.IRI,
  },
  definedBy: {
    '@id': sqlib.definedBy,
    '@type': ldkit.IRI,
  },
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
  },
  startedAt: {
    '@id': prov.startedAtTime,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  endedAt: {
    '@id': prov.endedAtTime,
    '@type': xsd.dateTime,
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

export interface LdkitBenchmarkIterationRun {
  $id: string;
  '@type'?: 'BenchmarkIterationRun';
  name?: string | null;
  description?: string | null;
  structure: string;
  definedBy: string;
  isPartOf: string;
  startedAt?: string | null;
  endedAt?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
