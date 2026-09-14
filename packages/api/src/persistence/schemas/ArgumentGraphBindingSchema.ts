/**
 * LDKit Schema for ArgumentGraphBinding Entity
 *
 * A data graph bound to one of a query group's start-node graph ports.
 *
 * Groups only. A query group's start node declares graph ports, which makes a
 * graph an argument in the same sense a `VALUES` clause's rows are. A query
 * declares no such parameter: its store is its backend, and "run this query
 * over that graph" is a backend hydrated from the graph
 * (`OxigraphDataGraphSource`). See `docs/concepts.md`.
 *
 * Which port a graph fills is *not* stored here — that is the group's, and the
 * binding carries only a `position` for the group to route against.
 *
 * Follows the binding pattern beside it: shape and metadata are entity fields,
 * content is a string. Exactly one source — a pinned `DataGraphVersion`, or
 * pasted RDF — enforced by the writer rather than the schema, matching how
 * `resolveDataGraphInput` already enforces it on the execute body.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib } from '../namespaces.js';

export const ArgumentGraphBindingSchema = {
  '@type': sqlib.ArgumentGraphBinding,
  /**
   * Where this graph sits in the set's ordered inputs — the routing key a
   * start-node graph port pairs against.
   *
   * See `position` on `ArgumentTupleBinding` for why it is explicit rather
   * than implied by the containing array.
   */
  position: {
    '@id': sqlib.position,
    '@type': xsd.integer,
    '@optional': true,
  },
  /**
   * A pinned version. Immutable content, so a saved set keeps meaning what it
   * meant — the same reason `ArgumentTupleBinding` pins tuple set versions.
   */
  dataGraphVersion: {
    '@id': sqlib.dataGraphVersion,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['DataGraphVersion'] },
  },
  /**
   * Pasted RDF, stored with the version.
   *
   * `2026-08-31` said inline graph content is "ephemeral, never written to the
   * library", and that still holds of the *library*: this never becomes a
   * `DataGraph`. What changed is that a saved argument set is a stored call, so
   * the graph it hands in is part of it.
   */
  contentString: {
    '@id': sqlib.contentString,
    '@type': xsd.string,
    '@optional': true,
  },
  contentFormat: {
    '@id': sqlib.contentFormat,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitArgumentGraphBinding {
  '$id': string;
  '@type'?: 'ArgumentGraphBinding';
  position?: number | null;
  dataGraphVersion?: string | null;
  contentString?: string | null;
  contentFormat?: string | null;
}
