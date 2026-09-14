/**
 * LDKit Schema for EtlColumnMapping Entity (Stable Pointer)
 *
 * Represents a stable column mapping configuration that points to versioned implementations.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const EtlColumnMappingSchema = {
  '@type': sqlib.EtlColumnMapping,
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
    '@references': { types: ['EtlColumnMappingVersion'] },
    // The number lives on the version; callers listing these want it
    // beside the entity. See `Property['@projects']`.
    '@projects': { as: 'currentVersionNumber', property: 'version' },
  },
  etlJobVersion: {
    '@id': sqlib.etlJobVersion,
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
} as const satisfies Schema;

export interface LdkitEtlColumnMapping {
  $id: string;
  '@type'?: 'EtlColumnMapping';
  name: string;
  description?: string | null;
  currentVersion?: string | null; // IRI pointing to latest EtlColumnMappingVersion
  etlJobVersion: string; // IRI to parent EtlJobVersion
  dateCreated?: string | null;
  dateModified?: string | null;
}
