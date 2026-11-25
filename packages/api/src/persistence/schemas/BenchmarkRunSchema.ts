/**
 * Entity schema for BenchmarkRun Entity (subject-level dataset).
 */

import type { Schema } from '../schema.js';
import { xsd, qb, prov, sqlib, sdo, rdf } from '../namespaces.js';
import { AUTHORSHIP_PROPERTIES } from '../authorship.js';

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
    '@type': sqlib.IRI,
  },
  definedBy: {
    '@id': sqlib.definedBy,
    '@type': sqlib.IRI,
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
  /*
   * Set when the run executed part of its version (issue #251): the ids of
   * the cases it selected. Absent or empty when it executed every case: a
   * selection holds at least one case, and the store reads an absent array
   * back as empty.
   */
  caseIds: {
    '@id': sqlib.selectedCases,
    '@array': true,
    '@optional': true,
  },
  /*
   * The pass the run belongs to. A pass is every run of one version that
   * names the same pass; it has no record of its own.
   */
  pass: {
    '@id': sqlib.benchmarkPass,
    '@optional': true,
  },
  /*
   * Facts the client recorded with the run, such as page-cache state or the
   * store's build: a flat JSON object of scalar values, capped in size.
   */
  context: {
    '@id': sqlib.runContext,
    '@type': rdf.JSON,
    '@jsonShape': 'BenchmarkRunContext',
    '@optional': true,
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
  ...AUTHORSHIP_PROPERTIES,
} as const satisfies Schema;

export interface PersistedBenchmarkRun {
  $id: string;
  '@type'?: 'BenchmarkRun';
  name?: string | null;
  description?: string | null;
  structure: string;
  definedBy: string;
  runStatus: string;
  tasksTotal: number;
  tasksCompleted: number;
  caseIds?: string[] | null;
  pass?: string | null;
  context?: Record<string, string | number | boolean | null> | null;
  keywords?: string[] | null;
  startedAt?: string | null;
  endedAt?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  createdBy?: string | null;
  modifiedBy?: string | null;
}
