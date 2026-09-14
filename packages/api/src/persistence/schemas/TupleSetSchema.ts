/**
 * LDKit Schema for TupleSet Entity (Stable Pointer)
 *
 * A named, versioned solution sequence — a table of RDF terms — registered in a
 * library. The tabular sibling of `DataGraph`: where a data graph is the RDF a
 * ruleset runs *against*, a tuple set is the rows a query's `VALUES` clause or a
 * ruleset's `TUPLE(…)` declaration is *filled with*.
 *
 * One tuple set is one relation — a single signature and its rows — not a whole
 * invocation's worth of arguments. The runtime has always been keyed this way
 * (`exportRuntimePayload` builds a `Map<signature, …>`; the wire array is that
 * map serialised), so this entity names what the map key stood for.
 *
 * See `docs/concepts.md`.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const TupleSetSchema = {
  '@type': sqlib.TupleSet,
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
    '@references': { types: ['TupleSetVersion'] },
    // The number lives on the version; callers listing these want it beside
    // the entity. See `Property['@projects']`.
    '@projects': { as: 'currentVersionNumber', property: 'version' },
  },
  isPartOf: {
    '@id': sdo.isPartOf,
    '@array': true,
    '@type': ldkit.IRI,
    '@references': { types: ['Library'], exactlyOne: 'Library' },
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

export interface LdkitTupleSet {
  $id: string;
  '@type'?: 'TupleSet';
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  isPartOf: string[];
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
