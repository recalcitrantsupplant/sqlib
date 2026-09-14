/**
 * LDKit Schema for DataBlockVersion entity.
 *
 * Represents an immutable snapshot of a data block.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const DataBlockVersionSchema = {
  '@type': sqlib.DataBlockVersion,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['DataBlock'] },
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
  dataString: {
    '@id': sqlib.rule, // Re-using 'rule' property for generic content
    '@type': xsd.string,
  },
  comment: {
    '@id': sdo.comment,
    '@optional': true,
  },
  normalizedInsertData: {
    '@id': sqlib.normalizedInsert, // Re-using for consistency
    '@type': xsd.string,
    '@optional': true,
  },
  grammarValid: {
    '@id': sqlib.grammarValid,
    '@type': xsd.boolean,
    '@optional': true,
  },
  validationError: {
    '@id': sqlib.validationError,
    '@type': xsd.string,
    '@optional': true,
  },
  grammarType: {
    '@id': sqlib.grammarType,
    '@type': xsd.string,
    '@optional': true,
  },
  grammarValidations: {
    '@id': sqlib.grammarValidations,
    '@type': xsd.string,
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

export interface LdkitDataBlockVersion {
  $id: string;
  '@type'?: 'DataBlockVersion';
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  dataString: string;
  comment?: string | null;
  normalizedInsertData?: string | null;
  grammarValid?: boolean | null;
  validationError?: string | null;
  grammarType?: string | null;  // 'srl' | 'sparql'
  grammarValidations?: string | null;  // JSON string of validation results
  dateCreated?: string | null;
  dateModified?: string | null;
}
