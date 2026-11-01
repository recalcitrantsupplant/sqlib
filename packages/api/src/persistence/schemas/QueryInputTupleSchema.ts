/**
 * LDKit Schema for QueryInputTuple Entity
 * 
 * Represents ordered tuples of input variables that belong together in VALUES clauses.
 * Each tuple has its own IRI and an ordered list of variable names.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const QueryInputTupleSchema = {
  '@type': sqlib.QueryInputTuple,
  name: {
    '@id': sdo.name,
    '@optional': true,
  },
  memberEntries: {
    '@id': sqlib.memberEntries,
    '@array': true,
    '@type': ldkit.IRI,
  },
  /**
   * Declaration ordinal, set only on a query group's *start node* ports.
   *
   * The start node's ports are minted by the group (`normalizeStartTuples`,
   * `origin: 'query-group'`), not inferred from a query version, so an ordinal
   * on them is the group's own and leaks nowhere. A tuple minted as a query
   * version's `inferredInputs` never carries one.
   *
   * It exists because the boundary pairs supplied arguments to ports by
   * position, and `StartNode.outputs` is an RDF `@array` whose order does not
   * survive a round-trip.
   */
  position: {
    '@id': sqlib.position,
    '@type': xsd.integer,
    '@optional': true,
  },
  /**
   * How a supplied table's columns line up with this port's variables, as the
   * JSON `{ source, target }[]` that `QueryEdge.variableMappings` already uses
   * — `source` a supplied column, `target` a declared variable.
   *
   * Same reason it lives on the group rather than travelling with the data:
   * reordering and partial consumption are facts about this wiring, and the
   * argument set that supplies the rows must stay offerable to other groups.
   * Unset, the boundary pairs exact names first and the remainder by position,
   * which is `resolveVariableMappings`'s default for every other hop.
   */
  variableMappings: {
    '@id': sqlib.variableMappings,
    '@optional': true,
  },
  /**
   * The query author's policy for this slot when it receives no bound rows: an
   * omitted slot, a lone all-UNDEF row, or zero rows. One of `WHEN_EMPTY_MODES`.
   *
   * Set only on a query version's `inferredInputs`. Unset keeps the built-in
   * reading (omitted runs open, zero rows match nothing). `require` is the guard
   * for a query that must never run open; see
   * `docs/proposals/required-arguments.md`. A group edge's own `whenEmpty`
   * wins over it, but cannot set `unconstrained` on a slot this closes.
   */
  whenEmpty: {
    '@id': sqlib.whenEmpty,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitQueryInputTuple {
  '$id': string;
  '@type'?: 'QueryInputTuple';
  name?: string | null; // Optional descriptive name, can be auto-generated
  memberEntries: string[]; // Array of TupleMember IRIs (ordered by position field)
  position?: number | null; // Start-node ports only: declaration ordinal
  variableMappings?: string | null; // Start-node ports only: JSON { source, target }[]
  whenEmpty?: string | null; // Query version inputs only: "unconstrained" | "propagateEmpty" | "require"
}
