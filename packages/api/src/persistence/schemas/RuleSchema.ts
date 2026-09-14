/**
 * LDKit Schema for Rule Entity (stable pointer)
 *
 * Mirrors the Query schema but dedicated to SPARQL-RL rules.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const RuleSchema = {
  '@type': sqlib.Rule,
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
    '@references': { types: ['RuleVersion'] },
    // The number lives on the version; callers listing these want it
    // beside the entity. See `Property['@projects']`.
    '@projects': { as: 'currentVersionNumber', property: 'version' },
  },
  isPartOf: {
    '@id': sdo.isPartOf,
    '@array': true,
    '@type': ldkit.IRI,
    '@references': { types: ['Library', 'QueryGroup'], exactlyOne: 'Library' },
  },
  tags: {
    '@id': sqlib.hasTag,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['Tag'] },
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

export interface LdkitRule {
  $id: string;
  '@type'?: 'Rule';
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  isPartOf: string[];
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
