/**
 * Schema for BenchmarkExperiment Entity
 *
 * Stable pointer to the current BenchmarkExperimentVersion.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const BenchmarkExperimentSchema = {
  '@type': sqlib.BenchmarkExperiment,
  name: {
    '@id': sdo.name,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  status: {
    '@id': sdo.creativeWorkStatus,
    '@optional': true,
  },
  /**
   * The library the experiment belongs to, which is what the entity guard
   * resolves to decide who may read, change or run it. Scalar, like
   * `QueryGroup.isPartOf`. Optional only because experiments stored before it
   * existed have none: those are administrator-only until
   * `scripts/backfill-benchmark-ownership.ts` assigns them, and every create
   * names one.
   */
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['Library'] },
  },
  currentVersion: {
    '@id': sqlib.currentVersion,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['BenchmarkExperimentVersion'] },
    // The number lives on the version; callers listing these want it
    // beside the entity. See `Property['@projects']`.
    '@projects': { as: 'currentVersionNumber', property: 'version' },
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

export interface BenchmarkExperimentEntity {
  $id: string;
  '@type'?: 'BenchmarkExperiment';
  name: string;
  description?: string | null;
  status?: string | null;
  isPartOf?: string | null;
  currentVersion?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
