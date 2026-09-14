/**
 * LDKit Schema for Patch entity.
 *
 * A patch is the ground set of quads one write added and removed: a preview
 * before it happens, an audit record after, an undo when reversed, and a
 * replication unit if it is ever shipped. The derivation lives in
 * `packages/rdf-delta`; this is where the result is kept.
 *
 * **Deliberately unversioned.** A patch *is* an event — it records one
 * evaluation at one moment against one store — so the stable/version split
 * every callable entity carries would be noise here. Re-running the *update*
 * elsewhere may produce a different patch; re-applying the *patch* reproduces
 * one specific change.
 *
 * **Contained by its backend, not by a library.** `isPartOf → Backend` is the
 * containment *and* the target: a patch describes backend data rather than a
 * library entity, and read access follows the backend's authz path. The design
 * doc names a separate `targetBackend` alongside the containment; one predicate
 * carries both facts, and a second would only be able to disagree with it.
 *
 * Both sides are stored as **canonical** N-Quads (RDFC-1.1, via
 * `canonicalizeNQuads`). That buys a `contentHash` stable enough to use as an
 * optimistic-concurrency precondition, patch equality that means something in
 * tests, and a deterministic serialisation for the log.
 *
 * See `docs/explanation/rdf-patch.md`.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const PatchSchema = {
  '@type': sqlib.Patch,
  /** The backend the patch applies to, and the container it belongs to. */
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['Backend'] },
  },
  /** Canonical N-Quads. Empty string when the side is empty. */
  additions: {
    '@id': sqlib.additions,
    '@type': xsd.string,
    '@optional': true,
  },
  deletions: {
    '@id': sqlib.deletions,
    '@type': xsd.string,
    '@optional': true,
  },
  additionCount: {
    '@id': sqlib.additionCount,
    '@type': xsd.integer,
  },
  deletionCount: {
    '@id': sqlib.deletionCount,
    '@type': xsd.integer,
  },
  /**
   * Template instantiations before the net-effect trim.
   *
   * Kept because "you asked to delete 12, 9 of them existed" is the half of a
   * preview a human actually reacts to, and it is unrecoverable from the net
   * counts alone.
   */
  rawInsertCount: {
    '@id': sqlib.rawInsertCount,
    '@type': xsd.integer,
    '@optional': true,
  },
  rawDeleteCount: {
    '@id': sqlib.rawDeleteCount,
    '@type': xsd.integer,
    '@optional': true,
  },
  /** Named graphs the patch touches. Absent means the default graph only. */
  graphScope: {
    '@id': sqlib.graphScope,
    '@type': ldkit.IRI,
    '@array': true,
    '@optional': true,
  },
  /**
   * Graph-management operations the update performs, as a JSON array.
   *
   * A JSON string for the same reason `Backend.oxigraphConfig` is one: the
   * record is a small closed structure read as a whole, and spreading it over
   * predicates would buy a queryability nothing asks for at the cost of a
   * shape that has to be reassembled on every read.
   *
   * Kept even when the operations *were* enumerated into the quad sets. "These
   * quads went because the graph was dropped" is a different fact from "these
   * quads were deleted", and it is the only place the former survives — an
   * empty graph created or removed leaves no quad behind at all.
   */
  graphOps: {
    '@id': sqlib.graphOps,
    '@type': xsd.string,
    '@optional': true,
  },
  /** `previewed` | `applied` | `failed` | `reverted`. */
  patchStatus: {
    '@id': sqlib.patchStatus,
    '@type': xsd.string,
  },
  /** `ground-sparql` | `store` | `graph-ops` — see `packages/rdf-delta`. */
  applyMode: {
    '@id': sqlib.applyMode,
    '@type': xsd.string,
  },
  revertible: {
    '@id': sqlib.revertible,
    '@type': xsd.boolean,
  },
  containsBnodes: {
    '@id': sqlib.containsBnodes,
    '@type': xsd.boolean,
    '@optional': true,
  },
  /** False when a blank-node deletion could not be tested for membership. */
  netEffectExact: {
    '@id': sqlib.netEffectExact,
    '@type': xsd.boolean,
    '@optional': true,
  },
  /** SHA-256 of the canonical deletions and additions. */
  contentHash: {
    '@id': sqlib.contentHash,
    '@type': xsd.string,
  },
  /** `updateString` | `revert` — what produced this patch. */
  sourceKind: {
    '@id': sqlib.sourceKind,
    '@type': xsd.string,
  },
  /** The entity the source refers to, when it is one. */
  sourceRef: {
    '@id': sqlib.sourceRef,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /** The update this patch was derived from, when it came from one. */
  updateString: {
    '@id': sqlib.updateString,
    '@type': xsd.string,
    '@optional': true,
  },
  /** Set on a revert patch: the patch it undoes. */
  inverseOf: {
    '@id': sqlib.inverseOf,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /** The writer's `x-sqlib-client-id`, mirroring the change feed. */
  origin: {
    '@id': sqlib.origin,
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
  dateApplied: {
    '@id': sqlib.dateApplied,
    '@type': xsd.dateTime,
    '@optional': true,
  },
} as const satisfies Schema;

export type PatchStatus = 'previewed' | 'applied' | 'failed' | 'reverted';
export type PatchApplyMode = 'ground-sparql' | 'store' | 'graph-ops';
/**
 * Where the change came from — and, for `proxyUpdate`, who made it.
 *
 * A `proxyUpdate` patch is the design's "passthrough" recording: the update ran
 * through the raw `/sparql` proxy exactly as the caller wrote it, and the diff
 * was derived beside it rather than applied by sqlib. That is a fact about the
 * *source*, deliberately not about `applyMode`: since graph-management support
 * landed, `applyMode` says whether a patch's quads are the whole update, which
 * is what revert and `POST /patches/apply` read. Overwriting it would make a
 * recorded LOAD look like something the quads could reproduce.
 */
export type PatchSourceKind = 'updateString' | 'revert' | 'proxyUpdate';

export interface LdkitPatch {
  $id: string;
  '@type'?: 'Patch';
  isPartOf: string;
  additions?: string | null;
  deletions?: string | null;
  additionCount: number;
  deletionCount: number;
  rawInsertCount?: number | null;
  rawDeleteCount?: number | null;
  graphScope?: string[] | null;
  graphOps?: string | null;
  patchStatus: PatchStatus;
  applyMode: PatchApplyMode;
  revertible: boolean;
  containsBnodes?: boolean | null;
  netEffectExact?: boolean | null;
  contentHash: string;
  sourceKind: PatchSourceKind;
  sourceRef?: string | null;
  updateString?: string | null;
  inverseOf?: string | null;
  origin?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  dateApplied?: string | null;
}
