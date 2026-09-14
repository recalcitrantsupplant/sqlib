/**
 * LDKit Schema for PatchNode Entity
 *
 * A query group execution node that answers "what would this update change?"
 * without changing it. It names an update `QueryVersion` and a store to read,
 * derives the ground patch with `packages/rdf-delta`, and emits the two halves
 * of that patch — deletions and additions — as separate RDF outputs.
 *
 * ## Why two output ports rather than one
 *
 * The delta-storage design asks for "a `PatchNode` whose output is a
 * `TriplesQuadsIO` pair (deletions, additions)". The pair is the point: a patch
 * is not a graph, and flattening it into one would lose the sign. Downstream,
 * "apply this" and "log this" are two edges off two ports rather than two modes
 * to design.
 *
 * The ports are named by their own properties rather than by position in
 * `outputs`, because an array index is not a contract: reordering `outputs` in
 * a client would silently swap what a rule set is fed. `GraphBuilder` enforces
 * that both are declared, distinct, and members of `outputs`.
 *
 * ## Why it never writes
 *
 * Derivation is read-only. A node that applied its own patch would make "show
 * me the diff" and "make the change" the same button in a DAG where nothing
 * downstream has seen the diff yet — and the apply path already exists, guarded
 * and re-derived, at `POST /patches/:id/apply`. So this node produces a value
 * and leaves what happens to it to the graph.
 */

import type { Schema } from '../schema.js';
import { ldkit, rdf, sqlib } from '../namespaces.js';

export const PatchNodeSchema = {
  '@type': sqlib.PatchNode,
  queryId: {
    '@id': sqlib.queryId,
    '@type': ldkit.IRI,
    '@references': { types: ['QueryVersion'] },
  },
  /**
   * Optional for the same reason it is on `QueryNode` (issue #297): a node with
   * an ephemeral `backendConfig` derives against that store and never reads
   * this. "Exactly one of the two" is a relationship between the properties
   * rather than a cardinality on either, so `GroupVersionWriter` enforces it.
   */
  backendId: {
    '@id': sqlib.backendId,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['Backend'] },
  },
  inputs: {
    '@id': sqlib.inputs,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  outputs: {
    '@id': sqlib.outputs,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /** The port carrying the quads the update would remove. */
  deletionsOutput: {
    '@id': sqlib.deletionsOutput,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['TriplesQuadsIO'] },
  },
  /** The port carrying the quads the update would add. */
  additionsOutput: {
    '@id': sqlib.additionsOutput,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['TriplesQuadsIO'] },
  },
  /** See `QueryNodeSchema.backendConfig` — `rdf:JSON`, not a plain literal. */
  backendConfig: {
    '@id': sqlib.backendConfig,
    '@type': rdf.JSON,
    '@jsonShape': 'EphemeralBackendConfig',
    '@optional': true,
  },
  nodeType: {
    '@id': sqlib.nodeType,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitPatchNode {
  '$id': string;
  '@type'?: 'PatchNode';
  /** The update QueryVersion whose effect is derived. */
  queryId: string;
  backendId?: string | null;
  inputs?: string[] | null;
  outputs?: string[] | null;
  deletionsOutput?: string | null;
  additionsOutput?: string | null;
  backendConfig?: { type: 'ephemeral-oxigraph'; storeId: string } | null;
  nodeType?: string | null;
}
