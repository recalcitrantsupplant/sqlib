/**
 * Previewing, applying and reverting patches.
 *
 * The derivation itself is `packages/rdf-delta`, which knows nothing about
 * backends, entities or HTTP. This module is everything around it: which store
 * a patch is derived from, how it is stored, what guards an apply, and what the
 * feed is told afterwards.
 *
 * Two decisions here are worth stating outright, because they are the ones a
 * reader would otherwise have to reconstruct:
 *
 * **A previewed patch is persisted.** An approval flow has to be able to point
 * at the thing that was approved — "apply patch X" is only meaningful if X
 * outlives the request that produced it. Previews that are never applied are
 * swept on a TTL rather than never written.
 *
 * **Applying re-derives.** A stored patch is a record of one evaluation at one
 * moment; the store may have moved since. So when a patch knows the update it
 * came from, apply derives again, compares `contentHash`, and refuses on a
 * mismatch (§8's optimistic guard) — then applies the *fresh* quads. That also
 * disposes of a subtler problem: blank nodes in a deletion set identify nodes
 * in the store, and a re-derivation names the ones that are there now rather
 * than the labels that were there at preview.
 */

import { createHash } from 'node:crypto';
import * as oxigraph from 'oxigraph';
import {
  derivePatch,
  patchToRdfPatch,
  patchToSparqlUpdate,
  quadsToNQuads,
  UnsupportedUpdateError,
  type DeriveOptions,
  type GraphOperationRecord,
  type Patch as DeltaPatch,
  type QuadLike,
} from '@sparql-query-lib/rdf-delta';
import { mintId } from './id.js';
import { canonicalizeNQuads } from './rdfCanonicalizer.js';
import { getEntityRepositories } from './CacheCoordinatorProvider.js';
import { publishDataChange } from './changeEvents.js';
import { markStoreWritten } from './storeWrites.js';
import { resolvePatchTarget, PatchTargetError, type PatchTarget } from './patchTargets.js';
import type { LdkitPatch, PatchSourceKind, PatchStatus } from '../persistence/schemas/PatchSchema.js';

export { PatchTargetError } from './patchTargets.js';
export { UnsupportedUpdateError } from '@sparql-query-lib/rdf-delta';

const N_QUADS = 'application/n-quads';

/** Raised when the store moved between deriving a patch and applying it. */
export class PatchConflictError extends Error {
  readonly statusCode = 409;
  readonly current: LdkitPatch;

  constructor(message: string, current: LdkitPatch) {
    super(message);
    this.name = 'PatchConflictError';
    this.current = current;
  }
}

export interface PreviewParams extends DeriveOptions {
  backendId: string;
  updateString: string;
  origin?: string | null;
}

export interface ApplyParams extends DeriveOptions {
  patchId: string;
  /** The hash the caller believes it approved. Checked before anything runs. */
  expectedHash?: string | null;
  /** Accept last-write-wins: skip the re-derivation guard. */
  force?: boolean;
  origin?: string | null;
}

/** Derive the patch an update would produce, and persist it as `previewed`. */
export async function previewUpdate(params: PreviewParams): Promise<LdkitPatch> {
  const target = await resolvePatchTarget(params.backendId);
  const delta = await derivePatch(params.updateString, target.deltaStore, deriveOptions(params));
  return persist(delta, {
    backendId: params.backendId,
    status: 'previewed',
    sourceKind: 'updateString',
    updateString: params.updateString,
    origin: params.origin ?? null,
  });
}

/** Preview and apply in one call, for callers with no approval gate. */
export async function applyUpdate(params: PreviewParams): Promise<LdkitPatch> {
  const target = await resolvePatchTarget(params.backendId);
  const delta = await derivePatch(params.updateString, target.deltaStore, deriveOptions(params));
  await applyDelta(target, delta);
  const record = await persist(delta, {
    backendId: params.backendId,
    status: 'applied',
    sourceKind: 'updateString',
    updateString: params.updateString,
    origin: params.origin ?? null,
    dateApplied: new Date().toISOString(),
  });
  announce(record, params.origin ?? null);
  return record;
}

export interface RecordParams extends PreviewParams {
  /**
   * Runs the update. The proxy keeps its own executor — the one it resolved
   * from the request, with the caller's grants behind it — so recording never
   * silently redirects a write to a second connection to the same backend.
   */
  run: () => Promise<void>;
}

/**
 * Derive the diff an update is about to make, let someone else run it, keep it.
 *
 * This is the raw proxy's `?record=patch`: the update goes to the backend as
 * the caller wrote it, so nothing about how it executes changes, and the patch
 * beside it is a witness rather than the instrument. Ordering is the whole
 * design — derivation reads the *pre*-update store, so it has to finish before
 * `run` starts, and the record is only written afterwards, when there is an
 * outcome to record.
 *
 * A derivation that fails fails the request before the update runs. Asking to
 * record a write is asking not to lose it, so an unsupported update form is
 * answered as a refusal rather than by quietly writing unrecorded.
 */
export async function recordPassthroughUpdate(params: RecordParams): Promise<LdkitPatch> {
  const target = await resolvePatchTarget(params.backendId);
  const delta = await derivePatch(params.updateString, target.deltaStore);

  const common = {
    backendId: params.backendId,
    // sqlib did not apply this one; the backend did, from the caller's SPARQL.
    sourceKind: 'proxyUpdate' as const,
    updateString: params.updateString,
    origin: params.origin ?? null,
  };

  try {
    await params.run();
  } catch (error) {
    // The log is honest about attempts too: a failed update leaves the diff it
    // would have made, marked as never having landed.
    await persist(delta, { ...common, status: 'failed' });
    throw error;
  }

  const record = await persist(delta, {
    ...common,
    status: 'applied',
    dateApplied: new Date().toISOString(),
  });
  announce(record, params.origin ?? null);
  return record;
}

/** Apply a patch that was previewed earlier, guarded against drift. */
export async function applyExistingPatch(params: ApplyParams): Promise<LdkitPatch> {
  const repos = getEntityRepositories();
  const stored = repos.Patch.get(params.patchId);
  if (!stored) {
    throw new PatchTargetError(`Patch not found: ${params.patchId}`, 404);
  }
  if (stored.patchStatus === 'applied') {
    throw new PatchTargetError('This patch has already been applied', 409);
  }
  if (params.expectedHash && params.expectedHash !== stored.contentHash) {
    throw new PatchConflictError('The patch changed since it was read', stored);
  }

  const target = await resolvePatchTarget(stored.isPartOf);
  const delta = await resolveDelta(stored, target, params);
  await applyDelta(target, delta);

  const dateApplied = new Date().toISOString();
  const applied = await repos.Patch.update(stored.$id, { patchStatus: 'applied', dateApplied });
  // The fallback is the record as it now is, not as it was read: a response
  // saying `applied` with no time is the same silence this whole path fixes.
  const record = applied ?? { ...stored, patchStatus: 'applied' as PatchStatus, dateApplied };
  announce(record, params.origin ?? null);
  return record;
}

/** Undo an applied patch by applying its inverse, recorded as its own patch. */
export async function revertPatch(patchId: string, origin?: string | null): Promise<LdkitPatch> {
  const repos = getEntityRepositories();
  const stored = repos.Patch.get(patchId);
  if (!stored) {
    throw new PatchTargetError(`Patch not found: ${patchId}`, 404);
  }
  if (stored.patchStatus !== 'applied') {
    throw new PatchTargetError('Only an applied patch can be reverted', 409);
  }
  if (!stored.revertible) {
    throw new PatchTargetError(
      stored.applyMode === 'graph-ops'
        ? 'This patch carries a graph-management operation that was counted rather than enumerated, ' +
          'so it never recorded what to put back. Re-preview it with enumerateGraphOps to get a ' +
          'revertible patch.'
        : 'This patch carries blank nodes, so its inverse would re-mint rather than restore them',
      409,
    );
  }

  const target = await resolvePatchTarget(stored.isPartOf);
  // The inverse of what was *recorded*, not a fresh derivation: reverting is
  // defined against the change that happened, whatever the store did since.
  const inverse: DeltaPatch = {
    ...toDeltaPatch(stored),
    additions: parseNQuads(stored.deletions ?? ''),
    deletions: parseNQuads(stored.additions ?? ''),
  };
  inverse.additionCount = inverse.additions.length;
  inverse.deletionCount = inverse.deletions.length;
  await applyDelta(target, inverse);

  await repos.Patch.update(stored.$id, { patchStatus: 'reverted' });
  const record = await persist(inverse, {
    backendId: stored.isPartOf,
    status: 'applied',
    sourceKind: 'revert',
    inverseOf: stored.$id,
    origin: origin ?? null,
    dateApplied: new Date().toISOString(),
  });
  announce(record, origin ?? null);
  return record;
}

/**
 * Delete previewed patches nobody applied.
 *
 * A preview is a proposal, and a proposal nobody acted on is litter. Applied
 * and reverted patches are the log and are never swept here — what bounds
 * *those* is a retention policy, which is a decision this does not make.
 */
export async function sweepPreviewedPatches(maxAgeMs: number, now = Date.now()): Promise<number> {
  const repos = getEntityRepositories();
  const stale = repos.Patch.list().filter((patch) => {
    if (patch.patchStatus !== 'previewed') return false;
    const created = patch.dateCreated ? Date.parse(patch.dateCreated) : NaN;
    return Number.isFinite(created) && now - created > maxAgeMs;
  });

  for (const patch of stale) {
    await repos.Patch.delete(patch.$id);
  }
  return stale.length;
}

/** The derivation knobs a caller may pass through, and nothing else. */
function deriveOptions(params: DeriveOptions): DeriveOptions {
  return {
    enumerateGraphOps: params.enumerateGraphOps,
    enumerationCap: params.enumerationCap,
  };
}

interface PersistOptions {
  backendId: string;
  status: PatchStatus;
  sourceKind: PatchSourceKind;
  updateString?: string;
  inverseOf?: string;
  origin: string | null;
  /**
   * When the quads reached the store, for a patch that is already applied.
   *
   * Stamped by the caller rather than here, because "when it landed" is the
   * moment `applyDelta` returned and not the moment the record was written —
   * and between those two sits `serialiseSides`, whose canonicalisation cost
   * grows with the patch. Absent for `previewed` and `failed`: neither
   * happened, so neither has a time to record.
   */
  dateApplied?: string;
}

async function persist(delta: DeltaPatch, options: PersistOptions): Promise<LdkitPatch> {
  const { additions, deletions } = await serialiseSides(delta);
  return getEntityRepositories().Patch.create({
    $id: mintId('patch'),
    isPartOf: options.backendId,
    additions,
    deletions,
    additionCount: delta.additionCount,
    deletionCount: delta.deletionCount,
    rawInsertCount: delta.rawInsertCount,
    rawDeleteCount: delta.rawDeleteCount,
    graphScope: graphScopeOf(delta),
    graphOps: delta.graphOps.length > 0 ? JSON.stringify(delta.graphOps) : null,
    patchStatus: options.status,
    applyMode: delta.applyMode,
    revertible: delta.revertible,
    containsBnodes: delta.containsBlankNodes,
    netEffectExact: delta.netEffectExact,
    contentHash: hashSides(deletions, additions),
    sourceKind: options.sourceKind,
    updateString: options.updateString ?? null,
    inverseOf: options.inverseOf ?? null,
    origin: options.origin,
    dateApplied: options.dateApplied ?? null,
  });
}

/**
 * Both sides as N-Quads, canonicalised where canonicalising is safe.
 *
 * Canonical form is what makes `contentHash` a usable precondition and patch
 * equality meaningful — but RDFC-1.1 relabels blank nodes, and in a deletion
 * set a blank node label *is* the identity of a node in the store. Relabelling
 * one would produce a patch that no longer names what it means to delete. So a
 * patch carrying blank nodes keeps the labels it was derived with, and is
 * exactly the patch that must be re-derived rather than replayed anyway.
 */
async function serialiseSides(delta: DeltaPatch): Promise<{ additions: string; deletions: string }> {
  const additions = quadsToNQuads(delta.additions);
  const deletions = quadsToNQuads(delta.deletions);
  if (delta.containsBlankNodes) {
    return { additions, deletions };
  }
  return {
    additions: await canonicalizeNQuads(additions),
    deletions: await canonicalizeNQuads(deletions),
  };
}

/**
 * A stored patch as an RDF Patch document.
 *
 * The [RDF Patch](https://afs.github.io/rdf-delta/rdf-patch.html) dialect
 * RDF-Delta uses, so a consumer that already speaks it needs no sqlib-specific
 * parser. Lives here rather than in a route because two surfaces serve it: the
 * patch entity (`GET /patches/:id`) and an update query's output
 * (`POST /execute` with `Accept: text/rdf-patch`), and a diff that rendered
 * differently depending on which door it came through would be a bug nobody
 * would think to look for.
 *
 * It reads the rows the record holds rather than re-deriving: this is a view of
 * what was written down, not a fresh evaluation.
 */
export function toRdfPatchDocument(patch: LdkitPatch): string {
  return patchToRdfPatch(
    {
      additions: parseNQuads(patch.additions ?? ''),
      deletions: parseNQuads(patch.deletions ?? ''),
      additionCount: patch.additionCount,
      deletionCount: patch.deletionCount,
      rawInsertCount: patch.rawInsertCount ?? patch.additionCount,
      rawDeleteCount: patch.rawDeleteCount ?? patch.deletionCount,
      containsBlankNodes: patch.containsBnodes ?? false,
      netEffectExact: patch.netEffectExact ?? true,
      applyMode: patch.applyMode,
      revertible: patch.revertible,
      graphOps: storedGraphOps(patch),
    },
    { id: patch.$id, previous: patch.inverseOf ?? undefined },
  );
}

function hashSides(deletions: string, additions: string): string {
  return createHash('sha256').update(`D\n${deletions}A\n${additions}`).digest('hex');
}

function graphScopeOf(delta: DeltaPatch): string[] {
  const graphs = new Set<string>();
  for (const quad of [...delta.additions, ...delta.deletions]) {
    const graph = quad.graph;
    if (graph && graph.termType === 'NamedNode') graphs.add(graph.value);
  }
  return [...graphs];
}

/**
 * The quads to apply for a stored patch.
 *
 * With an update string, that means deriving again and checking nothing moved;
 * without one — a revert patch — the recorded quads are the whole truth, since
 * there is no query that would reproduce them.
 */
async function resolveDelta(
  stored: LdkitPatch,
  target: PatchTarget,
  params: ApplyParams,
): Promise<DeltaPatch> {
  if (!stored.updateString) {
    return toDeltaPatch(stored);
  }

  // Re-derive the way the patch was derived, unless the caller says otherwise:
  // a patch previewed with enumeration and re-derived without it would not
  // match its own hash, and would refuse itself.
  const fresh = await derivePatch(stored.updateString, target.deltaStore, {
    enumerateGraphOps: params.enumerateGraphOps ?? enumerationWasUsed(stored),
    enumerationCap: params.enumerationCap,
  });
  if (params.force !== true) {
    const { additions, deletions } = await serialiseSides(fresh);
    if (hashSides(deletions, additions) !== stored.contentHash) {
      throw new PatchConflictError(
        'The store changed since this patch was previewed; re-preview and approve the new diff',
        stored,
      );
    }
  }
  return fresh;
}

async function applyDelta(target: PatchTarget, delta: DeltaPatch): Promise<void> {
  if (delta.applyMode === 'graph-ops') {
    // The quad sets do not express the whole update, so applying them would
    // leave the store in a state neither the preview nor the update describes.
    // Better to refuse and name the way out than to half-apply.
    const forms = delta.graphOps
      .filter((operation) => !operation.enumerated)
      .map((operation) => operation.form.toUpperCase())
      .join(', ');
    throw new PatchTargetError(
      `This patch carries ${forms} counted rather than enumerated, so its quads are not the whole ` +
        'update. Re-preview it with enumerateGraphOps, or run the update directly.',
      422,
    );
  }

  if (delta.additionCount === 0 && delta.deletionCount === 0) return;

  if (target.readOnly) {
    // Same refusal the executor makes, for the same reason: the store is
    // hydrated from data graphs, so the write would be undone on its next
    // reload and the log would record a change that did not survive.
    throw new PatchTargetError(
      `Backend ${target.backendId} is read-only: it is hydrated from data graphs, so a patch applied to it would be undone on the next reload.`,
      403,
    );
  }

  if (delta.applyMode === 'ground-sparql') {
    // One request, so a conforming store applies both blocks atomically.
    await target.executor.update(patchToSparqlUpdate(delta));
    return;
  }

  if (!target.store) {
    throw new PatchTargetError(
      'This patch carries blank nodes, which DELETE DATA forbids, and this backend is only reachable over SPARQL',
      422,
    );
  }

  for (const quad of delta.deletions) target.store.delete(toOxigraphQuad(quad));
  for (const quad of delta.additions) target.store.add(toOxigraphQuad(quad));
  // The quad-level branch reaches the store directly rather than through the
  // executor, so this is where it says so — a durable memory backend whose
  // patch went unrecorded would be skipped by the next checkpoint (#443). The
  // `ground-sparql` branch above needs no such line: `executor.update` marks it.
  markStoreWritten(target.store);
}

function announce(record: LdkitPatch, origin: string | null): void {
  publishDataChange({ backendId: record.isPartOf, patchId: record.$id, origin });
}

/** The graph operations a stored patch recorded, or none. */
export function storedGraphOps(stored: LdkitPatch): GraphOperationRecord[] {
  if (!stored.graphOps) return [];
  try {
    const parsed: unknown = JSON.parse(stored.graphOps);
    return Array.isArray(parsed) ? (parsed as GraphOperationRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * Whether the stored patch was derived with enumeration on.
 *
 * Read back off the records rather than kept as its own flag: a patch that
 * enumerated every graph operation it has *is* one derived with enumeration,
 * and a second field could only ever disagree with them. `every` rather than
 * `some`, because `CREATE` reports itself enumerated either way — it moves no
 * triples, so there is nothing for the option to change.
 */
function enumerationWasUsed(stored: LdkitPatch): boolean {
  const records = storedGraphOps(stored);
  return records.length > 0 && records.every((operation) => operation.enumerated);
}

function toDeltaPatch(stored: LdkitPatch): DeltaPatch {
  const additions = parseNQuads(stored.additions ?? '');
  const deletions = parseNQuads(stored.deletions ?? '');
  return {
    graphOps: storedGraphOps(stored),
    additions,
    deletions,
    additionCount: additions.length,
    deletionCount: deletions.length,
    rawInsertCount: stored.rawInsertCount ?? additions.length,
    rawDeleteCount: stored.rawDeleteCount ?? deletions.length,
    containsBlankNodes: stored.containsBnodes ?? false,
    netEffectExact: stored.netEffectExact ?? true,
    applyMode: stored.applyMode,
    revertible: stored.revertible,
  };
}

function parseNQuads(document: string): QuadLike[] {
  if (!document.trim()) return [];
  const store = new oxigraph.Store();
  store.load(document, { format: N_QUADS });
  return store.match(null, null, null, null) as unknown as QuadLike[];
}

function toOxigraphQuad(quad: QuadLike): oxigraph.Quad {
  const graph = quad.graph;
  const graphTerm =
    graph && graph.termType === 'NamedNode' ? oxigraph.namedNode(graph.value) : oxigraph.defaultGraph();
  return oxigraph.quad(
    quad.subject as unknown as oxigraph.Quad['subject'],
    quad.predicate as unknown as oxigraph.Quad['predicate'],
    quad.object as unknown as oxigraph.Quad['object'],
    graphTerm,
  );
}
