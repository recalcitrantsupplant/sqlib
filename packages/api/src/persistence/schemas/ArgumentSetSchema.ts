/**
 * LDKit Schema for ArgumentSet Entity
 *
 * Top-level container for saved argument presets associated with a query or query group.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const ArgumentSetSchema = {
  '@type': sqlib.ArgumentSet,
  name: {
    '@id': sdo.name,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  /*
   * Provenance, and optional since argument sets became composable from the
   * rail. A set made on a query's screen records that it was; one composed
   * standalone records nothing, and fits whatever its parameters fit. Scope was
   * never a fence (`2026-08-14` §5) — the switcher has always offered a set to
   * any callable whose signature it matches — so the absence is "made nowhere
   * in particular", not "belongs nowhere".
   */
  argumentScope: {
    '@id': sqlib.argumentScope,
    '@optional': true,
  },
  targetEntity: {
    '@id': sqlib.targetEntity,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /**
   * The library this set belongs to — containment, as distinct from
   * `targetEntity`, which is provenance ("where it was made", see
   * `docs/concepts.md`). Without it the only path to a library ran through the
   * target, which is why a library-wide listing could not exist.
   *
   * Required, so it is also a *filter*: `readQueryGenerator` demands the triple,
   * and a set lacking one is not returned at all. That is intended — an argument
   * set outside a library is addressable by no screen, and should read as
   * missing rather than linger as orphaned data.
   */
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['Library'] },
  },
  tags: {
    '@id': sqlib.hasTag,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['Tag'] },
  },
  currentVersion: {
    '@id': sqlib.currentVersion,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['ArgumentSetVersion'] },
    // The number lives on the version; callers listing these want it
    // beside the entity. See `Property['@projects']`.
    '@projects': { as: 'currentVersionNumber', property: 'version' },
  },
  tupleBindings: {
    '@id': sqlib.tupleBindings,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  scalarBindings: {
    '@id': sqlib.scalarBindings,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  tupleSignature: {
    '@id': sqlib.tupleSignature,
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

export interface LdkitArgumentSet {
  '$id': string;
  '@type'?: 'ArgumentSet';
  name: string;
  description?: string | null;
  argumentScope?: 'query' | 'queryGroup' | null;
  targetEntity?: string | null;
  isPartOf: string;
  tags?: string[] | null;
  currentVersion?: string | null;
  tupleBindings?: string[] | null;
  scalarBindings?: string[] | null;
  tupleSignature?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
