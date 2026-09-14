/**
 * LDKit Schema for ArgumentTupleBinding Entity
 *
 * A VALUES signature (ordered variables) and the sources that fill it:
 * inline rows as SPARQL Results JSON, plus any pinned tuple set versions.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib } from '../namespaces.js';

export const ArgumentTupleBindingSchema = {
  '@type': sqlib.ArgumentTupleBinding,
  /**
   * Where this table sits in the set's ordered inputs.
   *
   * An argument set is payload and a group owns the routing, so the position
   * is the routing key a start-node port pairs against
   * (`2026-09-07-payload-and-routing.md` §4). Explicit rather than implied by
   * `ArgumentSetVersion.tupleBindings`, because an RDF `@array` is a set and
   * its order does not survive a round-trip. `TupleMember.position` is the
   * precedent. Optional: a set written before this defaults to array order.
   */
  position: {
    '@id': sqlib.position,
    '@type': xsd.integer,
    '@optional': true,
  },
  tupleSignature: {
    '@id': sqlib.tupleSignature,
  },
  fallbackVariables: {
    '@id': sqlib.fallbackVariables,
    '@array': true,
    '@optional': true,
  },
  /**
   * Inline rows, as a SPARQL Results JSON string.
   *
   * The binding is shape and metadata — signature and sources — which is what
   * the catalog keeps as entities; only its content is a string, matching
   * `QueryVersion.queryString` and `DataGraphVersion.contentString`. An earlier
   * model gave every *cell* its own `ArgumentValue` and every row an
   * `ArgumentRow`, making a 5,000×4 table ~25,000 entities that nothing ever
   * queried as RDF.
   */
  contentString: {
    '@id': sqlib.contentString,
    '@type': xsd.string,
  },
  /**
   * Tuple set versions whose rows fill this clause, unioned with any inline
   * content. Pinned version IRIs rather than stable ids: a saved argument
   * set must keep meaning what it meant, the same reason `RuleSetVersion`
   * pins rule versions.
   */
  tupleSetVersions: {
    '@id': sqlib.tupleSetVersions,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['TupleSetVersion'] },
  },
  provenanceTupleId: {
    '@id': sqlib.provenanceTupleId,
    '@type': ldkit.IRI,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitArgumentTupleBinding {
  '$id': string;
  '@type'?: 'ArgumentTupleBinding';
  position?: number | null;
  tupleSignature: string;
  fallbackVariables?: string[] | null;
  /** SPARQL Results JSON. */
  contentString: string;
  tupleSetVersions?: string[] | null;
  provenanceTupleId?: string | null;
}
