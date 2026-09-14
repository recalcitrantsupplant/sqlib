/**
 * LDKit Schema for EtlJob Entity (Stable Pointer)
 *
 * Represents a stable ETL job entity that points to versioned ETL job implementations.
 * The stable IRI never changes, but currentVersion points to the latest EtlJobVersion.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const EtlJobSchema = {
  '@type': sqlib.EtlJob,
  name: {
    '@id': sdo.name,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  currentVersion: {
    '@id': sqlib.currentVersion,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['EtlJobVersion'] },
    // The number lives on the version; callers listing these want it
    // beside the entity. See `Property['@projects']`.
    '@projects': { as: 'currentVersionNumber', property: 'version' },
  },
  isPartOf: {
    '@id': sdo.isPartOf,
    '@array': true,
    '@type': ldkit.IRI,
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
  argumentSets: {
    '@id': sqlib.argumentSets,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitEtlJob {
  $id: string;
  '@type'?: 'EtlJob';
  name: string;
  description?: string | null;
  currentVersion?: string | null; // IRI pointing to latest EtlJobVersion
  isPartOf: string[]; // IRIs - can include libraries
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
  argumentSets?: string[] | null;
}
