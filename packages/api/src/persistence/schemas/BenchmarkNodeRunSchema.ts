/**
 * LDKit Schema for BenchmarkNodeRun Entity (node-level dataset).
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, qb, prov, sqlib, sdo } from '../namespaces.js';

export const BenchmarkNodeRunSchema = {
  '@type': sqlib.BenchmarkNodeRun,
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

export interface LdkitBenchmarkNodeRun {
  $id: string;
  '@type'?: 'BenchmarkNodeRun';
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
