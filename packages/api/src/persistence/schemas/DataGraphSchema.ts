/**
 * LDKit Schema for DataGraph Entity (stable pointer)
 *
 * A DataGraph is reference/example RDF registered in the library — the *input*
 * a ruleset runs against (`G0` in the SHACL 1.2 Rules semantics), not part of
 * the ruleset itself. DATA blocks are part of a ruleset and come out in the
 * inference graph; a data graph never does. See `docs/concepts.md`.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const DataGraphSchema = {
  '@type': sqlib.DataGraph,
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
    '@references': { types: ['DataGraphVersion'] },
    // The number lives on the version; callers listing these want it
    // beside the entity. See `Property['@projects']`.
    '@projects': { as: 'currentVersionNumber', property: 'version' },
  },
  isPartOf: {
    '@id': sdo.isPartOf,
    '@array': true,
    '@type': ldkit.IRI,
    '@references': { types: ['Library'], exactlyOne: 'Library' },
  },
  /**
   * The argument set this graph was minted from, when it was born by pasting
   * RDF into a call rather than composed on the rail.
   *
   * Origin, not ownership: the graph is an ordinary `DataGraph` the moment it
   * exists, reusable anywhere in its library. This is only what lets the rail
   * say at a glance where a row came from (*Composed here* / *From groups*),
   * which is a view over one list rather than a move — and deliberately not a
   * tag, because auto-tagging by provenance makes a tag mean both "I decided
   * this" and "the system asserted this".
   */
  mintedFrom: {
    '@id': sqlib.mintedFrom,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['ArgumentSet'] },
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

export interface LdkitDataGraph {
  $id: string;
  '@type'?: 'DataGraph';
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  isPartOf: string[];
  /** The argument set this graph was minted from; absent on one composed here. */
  mintedFrom?: string | null;
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
