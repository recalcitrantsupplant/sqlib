/**
 * LDKit Schema for BenchmarkExperiment Entity
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

export interface LdkitBenchmarkExperiment {
  $id: string;
  '@type'?: 'BenchmarkExperiment';
  name: string;
  description?: string | null;
  status?: string | null;
  currentVersion?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
