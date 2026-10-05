/**
 * LDKit Schema for RuleSet Entity (stable pointer)
 *
 * A RuleSet is a collection of rules and data blocks.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const RuleSetSchema = {
  '@type': sqlib.RuleSet,
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
    '@references': { types: ['RuleSetVersion'] },
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
  /**
   * The data graph the web app selects for each input when this opens, by
   * position. A browser default: execution never reads it. Written through
   * `PUT /:id/browser-defaults`.
   */
  browserDefaultDataGraphs: {
    '@id': sqlib.browserDefaultDataGraphs,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
    '@readOnly': true,
    '@references': { types: ['BrowserDefaultDataGraph'] },
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

export interface LdkitRuleSet {
  $id: string;
  '@type'?: 'RuleSet';
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  isPartOf: string[];
  tags?: string[] | null;
  browserDefaultDataGraphs?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
