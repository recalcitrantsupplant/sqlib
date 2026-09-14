/**
 * LDKit Schema for BenchmarkRun Entity (subject-level dataset).
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, qb, prov, sqlib, sdo } from '../namespaces.js';

export const BenchmarkRunSchema = {
  '@type': sqlib.BenchmarkRun,
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
  runStatus: {
    '@id': sqlib.runStatus,
  },
  tasksTotal: {
    '@id': sqlib.tasksTotal,
    '@type': xsd.integer,
  },
  tasksCompleted: {
    '@id': sqlib.tasksCompleted,
    '@type': xsd.integer,
  },
  keywords: {
    '@id': sdo.keywords,
    '@array': true,
    '@optional': true,
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

export interface LdkitBenchmarkRun {
  $id: string;
  '@type'?: 'BenchmarkRun';
  name?: string | null;
  description?: string | null;
  structure: string;
  definedBy: string;
  runStatus: string;
  tasksTotal: number;
  tasksCompleted: number;
  keywords?: string[] | null;
  startedAt?: string | null;
  endedAt?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
