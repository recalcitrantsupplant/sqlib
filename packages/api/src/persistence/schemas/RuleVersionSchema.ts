/**
 * LDKit Schema for RuleVersion entity.
 *
 * Represents an immutable snapshot of a SPARQL-RL rule definition.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const RuleVersionSchema = {
  '@type': sqlib.RuleVersion,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['Rule'] },
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
  ruleString: {
    '@id': sqlib.rule,
    '@type': xsd.string,
  },
  comment: {
    '@id': sdo.comment,
    '@optional': true,
  },
  normalizedInsert: {
    '@id': sqlib.normalizedInsert,
    '@type': xsd.string,
    '@optional': true,
  },
  grammarType: {
    '@id': sqlib.grammarType,
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

export interface LdkitRuleVersion {
  $id: string;
  '@type'?: 'RuleVersion';
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  ruleString: string;
  comment?: string | null;
  normalizedInsert?: string | null;
  grammarType?: string | null;  // 'srl' | 'sparql'
  grammarValid?: boolean | null;
  validationError?: string | null;
  grammarValidations?: string | null;  // JSON string of validation results
  dateCreated?: string | null;
  dateModified?: string | null;
}
