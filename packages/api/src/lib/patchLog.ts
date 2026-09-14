/**
 * The stored `Patch` log, read as a sequence of quad-level operations.
 *
 * The delta-storage design puts "patch → DuckDB log" in its third milestone
 * and sizes it as "DuckDB log sink + AS-OF view". The sink's SQL is
 * `@sparql-query-lib/rdf-delta`'s `patchLog.ts`, promoted there from POC-2.
 * This module is the other half: turning what the triplestore holds into the
 * rows that SQL reads.
 *
 * It is deliberately pure — no DuckDB, no repository, no Fastify — so that the
 * two things worth arguing about can be argued about in a unit test:
 *
 * 1. **What order the log is in.** POC-2's whole semantics is last-write-wins
 *    by `seq`, and `seq` is a total order. The stored log does not have one.
 * 2. **Which quads the fold can be trusted about.** Blank nodes are labelled
 *    per patch, so their labels do not identify anything across patches.
 *
 * See `docs/explanation/storage-and-caching.md`.
 */

import rdfCanonize from 'rdf-canonize';
import * as oxigraph from 'oxigraph';
import { DEFAULT_GRAPH_COLUMN, type PatchLogRow } from '@sparql-query-lib/rdf-delta';
import { termToNQuad, type RenderableQuad, type RenderableTerm } from './nquads.js';
import type { LdkitPatch } from '../persistence/schemas/PatchSchema.js';

/**
 * The statuses whose quads actually reached the store.
 *
 * `previewed` and `failed` never happened, so they are not history. `reverted`
 * did: a revert does not erase a patch, it appends the inverse one — so the
 * reverted patch and the patch that undid it are both in the log, in order,
 * and the fold cancels them out on its own. Dropping the reverted half would
 * leave the inverse deleting quads nothing ever added.
 */
export const PATCH_LOG_STATUSES = new Set(['applied', 'reverted']);

/**
 * Why a log's order, or its fold, is not fully determined.
 *
 * Reported rather than thrown: a caller asking "what did this backend look
 * like at patch 40" is better served by an answer plus its caveat than by a
 * refusal, and every one of these is a property of the data rather than of the
 * request.
 */
export interface PatchLogCaveat {
  kind:
    | 'tied-timestamp'
    | 'undated'
    | 'assumed-apply-time'
    | 'revert-before-target'
    | 'blank-nodes'
    | 'inexact-net-effect';
  /** The patches the caveat is about. */
  patches: string[];
  message: string;
}

export interface PatchLogOrdering {
  /** The patches in log order, oldest first. */
  ordered: LdkitPatch[];
  caveats: PatchLogCaveat[];
}

/**
 * The log in order, oldest first.
 *
 * **The stored log has no total order, and this is the finding that matters
 * most for the sink.** `Patch` records `dateApplied` and `dateCreated`, both
 * millisecond timestamps, and `$id` is `mintId('patch')` — a dashless v4 UUID,
 * which is random and sorts as nothing. `GET /backends/:id/patches` sorts on
 * `dateCreated` alone, which is right for the questions it is written for
 * ("what just happened", "what do I undo": both live at the head and neither
 * cares how ties break). Reconstruction is not one of those questions: fold
 * two same-millisecond patches the wrong way round and one deletes what the
 * other added.
 *
 * **And until `dateApplied` was actually written, the primary term was mostly
 * inert.** Three of the four writers passed it to `persist`, which never put it
 * on the record, so the key fell through to `dateCreated` — stamped when the
 * record was written rather than when the quads landed, with `serialiseSides`
 * in between. Canonicalisation costs grow with the patch, so a large patch
 * applied first could be written second and folded second. That is fixed in
 * `patchService.persist`; the `dateCreated` fallback stays for patches stored
 * before it, and those are what `assumed-apply-time` is about.
 *
 * So the key here is `(dateApplied ?? dateCreated, contentHash, $id)`. It is
 * deterministic, which is the property the fold actually needs — the same log
 * reconstructs to the same graph on every run and on every replica — and it is
 * *causally* right everywhere the timestamps separate. Where they do not, the
 * tiebreak is arbitrary, and rather than hide that, a tie between patches of
 * differing content is reported as a `tied-timestamp` caveat.
 *
 * Two same-millisecond patches with the *same* `contentHash` are not a caveat:
 * identical add and delete sets fold to the same state whichever order they go
 * in, so there is nothing for a caller to be told.
 *
 * **`inverseOf` outranks the key, because it is the one causal fact the store
 * actually records.** A revert is not an independent write that happens to come
 * later: `revertPatch` applies the inverse of a patch that had already landed,
 * and writes the link saying so. So a revert is placed immediately after the
 * patch it undoes whatever the clocks say, and a tie the link decides is not a
 * `tied-timestamp` caveat — the order is recorded rather than guessed. Where
 * the clock actively disagrees, that is worth a caller knowing rather than
 * silently repairing, so it is a `revert-before-target` caveat.
 *
 * **A log patch with no `dateApplied` is placed by a clock that means something
 * else**, and reported as `assumed-apply-time`. `dateCreated` is stamped when
 * the *record* was written, which for `applyExistingPatch` is the moment the
 * preview was persisted — so the substitute is not a canonicalisation offset
 * away from the apply, it is the whole approval delay away, and it sorts the
 * patch before everything that happened while it waited. `undated` cannot
 * report this because it fires only when *both* stamps are missing, which is a
 * strictly rarer thing.
 *
 * The durable fix for a genuine tie is a stored per-backend `sequence` assigned
 * at apply time, which is a stored-vocabulary change and therefore a decision
 * rather than something to slip in underneath this one. §6 of the design note.
 */
export function orderPatchLog(patches: readonly LdkitPatch[]): PatchLogOrdering {
  const caveats: PatchLogCaveat[] = [];

  const byKey = [...patches].sort((left, right) => {
    const byTime = compareStamps(stampOf(left), stampOf(right));
    if (byTime !== 0) return byTime;
    const byHash = (left.contentHash ?? '').localeCompare(right.contentHash ?? '');
    if (byHash !== 0) return byHash;
    return left.$id.localeCompare(right.$id);
  });

  const { ordered, contradicted } = orderRevertsAfterTargets(byKey);

  const undated = ordered.filter((patch) => stampOf(patch) === NO_STAMP);
  if (undated.length > 0) {
    caveats.push({
      kind: 'undated',
      patches: undated.map((patch) => patch.$id),
      message:
        `${undated.length} patch(es) carry no usable dateApplied or dateCreated, so nothing places them in the log. `
        + 'They are folded last, in content order.',
    });
  }

  const assumed = ordered.filter(
    (patch) => !hasStamp(patch.dateApplied) && stampOf(patch) !== NO_STAMP,
  );
  if (assumed.length > 0) {
    caveats.push({
      kind: 'assumed-apply-time',
      patches: assumed.map((patch) => patch.$id),
      message:
        `${assumed.length} patch(es) carry no dateApplied, so they are placed by dateCreated — when the record `
        + 'was written rather than when the quads landed. A patch applied from an earlier preview was created '
        + 'when the diff was proposed, so its position here is as old as the approval that followed it.',
    });
  }

  for (const [target, inverse] of contradicted) {
    caveats.push({
      kind: 'revert-before-target',
      patches: [target, inverse],
      message:
        'A revert is timestamped before the patch it undoes, which cannot be what happened. It is folded '
        + 'immediately after its target, because inverseOf is a recorded fact and the timestamps are a '
        + 'measurement — but one of the two is wrong.',
    });
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (stampOf(previous) !== stampOf(current)) continue;
    if (stampOf(previous) === NO_STAMP) continue;
    if ((previous.contentHash ?? '') === (current.contentHash ?? '')) continue;
    // A tie the revert link broke is not an arbitrary tiebreak.
    if (current.inverseOf === previous.$id) continue;
    caveats.push({
      kind: 'tied-timestamp',
      patches: [previous.$id, current.$id],
      message:
        'Two patches of differing content share a timestamp, so their relative order is an arbitrary '
        + 'tiebreak rather than a recorded fact. The fold is deterministic but may not be causal.',
    });
  }

  return { ordered, caveats };
}

/** The stamp of a patch that has none. Sorts last, and is not a number to subtract. */
const NO_STAMP = Number.POSITIVE_INFINITY;

/** Whether a stored timestamp places anything. */
function hasStamp(raw: string | null | undefined): boolean {
  return !!raw && Number.isFinite(Date.parse(raw));
}

/**
 * When a patch's quads reached the store, as far as the record says.
 *
 * `dateApplied` shadows `dateCreated` even when it is unparseable: a patch that
 * claims an apply time this cannot read is not one to place by a different
 * clock entirely.
 */
function stampOf(patch: LdkitPatch): number {
  const raw = patch.dateApplied ?? patch.dateCreated ?? null;
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : NO_STAMP;
}

/**
 * Compare two stamps as a total order.
 *
 * Subtraction was the obvious spelling and it is the one that breaks: two
 * absent stamps are both `+Infinity`, and `Infinity - Infinity` is `NaN`, which
 * `Array.prototype.sort` reads as *equal* (the spec coerces a NaN comparison to
 * `+0`) — but only after the comparator has already returned, so the
 * `contentHash` and `$id` tiebreaks below it never run. Two undated patches
 * therefore came out in whatever order the repository happened to list them,
 * which is the one thing this ordering exists to rule out: determinism is what
 * makes a fold reproducible across runs and replicas, and `list()` promises no
 * order at all.
 */
function compareStamps(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

interface RevertPrecedence {
  ordered: LdkitPatch[];
  /**
   * `[target, inverse]` pairs where the clocks put the revert *before* the patch
   * it undoes. A pair the clocks merely tied on is not here: the link decided an
   * order nothing else had one for, which is a fact rather than a caveat.
   */
  contradicted: Array<[string, string]>;
}

/**
 * Move every revert to just after the patch it undoes.
 *
 * One pass over the key order, deferring a revert whose target has not been
 * emitted yet and releasing it the moment the target is. That makes the
 * adjustment minimal — a revert is placed against its own target and nothing
 * else moves — which matters because a revert whose clock disagrees with the
 * link disagrees with *third* patches too, and there is no reason to believe a
 * broken stamp about those either.
 *
 * A chain (a revert of a revert) falls out of the same pass, and a cycle —
 * which `revertPatch` cannot write, since it names a patch that is already
 * applied — leaves its members unemitted rather than looping. They are appended
 * in key order, so the result is a permutation of the input whatever the data.
 */
function orderRevertsAfterTargets(byKey: readonly LdkitPatch[]): RevertPrecedence {
  const known = new Map(byKey.map((patch) => [patch.$id, patch]));
  const deferred = new Map<string, LdkitPatch[]>();
  const emitted = new Set<string>();
  const ordered: LdkitPatch[] = [];
  const contradicted: Array<[string, string]> = [];

  const emit = (first: LdkitPatch): void => {
    const pending = [first];
    while (pending.length > 0) {
      const patch = pending.shift()!;
      ordered.push(patch);
      emitted.add(patch.$id);
      const released = deferred.get(patch.$id);
      if (released) {
        deferred.delete(patch.$id);
        // Unshifted rather than pushed: the releases keep key order among
        // themselves, and each is placed before whatever the outer loop reaches
        // next.
        pending.unshift(...released);
      }
    }
  };

  for (const patch of byKey) {
    const targetId = patch.inverseOf && patch.inverseOf !== patch.$id ? patch.inverseOf : null;
    const target = targetId === null ? undefined : known.get(targetId);
    if (!target || emitted.has(target.$id)) {
      emit(patch);
      continue;
    }
    if (compareStamps(stampOf(patch), stampOf(target)) !== 0) {
      contradicted.push([target.$id, patch.$id]);
    }
    const queue = deferred.get(target.$id);
    if (queue) queue.push(patch);
    else deferred.set(target.$id, [patch]);
  }

  // Only a cycle can leave anything here. Appending in key order keeps the
  // result a permutation of the input, which the fold's ordinals rely on.
  for (const patch of byKey) {
    if (!emitted.has(patch.$id)) {
      ordered.push(patch);
      emitted.add(patch.$id);
    }
  }

  return { ordered, contradicted };
}

/**
 * Parse one side of a patch into quads.
 *
 * The dual path is the rule `rdfCanonicalizer` already sets and for the same
 * reason: `rdf-canonize` does not know RDF 1.2 syntax, and Oxigraph does, but
 * routing every patch through an Oxigraph parse to serve the minority that use
 * triple terms would be paying for them everywhere.
 */
function parseSide(nquads: string | null | undefined): RenderableQuad[] {
  if (!nquads || !nquads.trim()) return [];
  if (!nquads.includes('<<(')) {
    return rdfCanonize.NQuads.parse(nquads) as unknown as RenderableQuad[];
  }
  const store = new oxigraph.Store();
  store.load(nquads, { format: 'application/n-quads' });
  return store.match() as unknown as RenderableQuad[];
}

/** Whether a term, or anything nested inside it, is a blank node. */
function hasBlankNode(term: RenderableTerm | undefined): boolean {
  if (!term) return false;
  if (term.termType === 'BlankNode') return true;
  if (term.termType !== 'Quad') return false;
  return hasBlankNode(term.subject) || hasBlankNode(term.predicate) || hasBlankNode(term.object);
}

export interface PatchLogBuild {
  rows: PatchLogRow[];
  /** `patch` column value → the patch it came from, in log order. */
  patchIds: string[];
  caveats: PatchLogCaveat[];
}

/**
 * The log, as rows.
 *
 * **Within a patch, deletions precede additions**, because that is the order
 * the write performed them: `DELETE/INSERT` deletes then inserts, so a quad
 * both sides name ends present. Ordering them the other way would fold it out.
 *
 * **Blank-node labels are qualified by their patch.** Both sides of a `Patch`
 * are canonical N-Quads, and RDFC-1.1 labels canonically *within a dataset* —
 * so `_:c14n0` in patch 3 and `_:c14n0` in patch 7 are two different nodes
 * wearing one name. A log keyed on term text would fold them together, and the
 * failure is not a missing answer but a wrong one: patch 7's delete would
 * retract patch 3's quad. Qualifying the label makes them distinct, which
 * costs the one thing that was never sound anyway — matching a blank node
 * across patches — and it is why a log containing any is reported as
 * `blank-nodes` rather than quietly served.
 *
 * That caveat is the reader's counterpart of the `netEffectExact` flag the
 * patch already carries: `inexact-net-effect` says the *patch* understates
 * what changed, `blank-nodes` says the *fold across patches* cannot see
 * through a label. A patch can have either without the other.
 */
export function buildPatchLog(patches: readonly LdkitPatch[]): PatchLogBuild {
  const { ordered, caveats } = orderPatchLog(patches);
  const rows: PatchLogRow[] = [];
  const patchIds: string[] = [];
  const withBlankNodes: string[] = [];
  const inexact: string[] = [];

  let seq = 0;
  ordered.forEach((patch, index) => {
    const ordinal = index + 1;
    patchIds.push(patch.$id);
    if (patch.netEffectExact === false) inexact.push(patch.$id);

    /*
     * Rebuilt field by field rather than spread: a term from Oxigraph is a
     * class instance whose properties live on the prototype as getters, so
     * `{ ...term }` copies nothing and the result has no `termType` at all.
     * The `rdf-canonize` path hands back plain objects and would survive a
     * spread, which is exactly why this would have been a bug only for RDF 1.2
     * patches.
     */
    const label = (term: RenderableTerm): RenderableTerm => {
      if (term.termType === 'BlankNode') {
        return { termType: 'BlankNode', value: `p${ordinal}.${term.value}` };
      }
      if (term.termType === 'Quad') {
        return {
          termType: 'Quad',
          value: '',
          subject: label(term.subject!),
          predicate: label(term.predicate!),
          object: label(term.object!),
        };
      }
      return term;
    };

    let sawBlankNode = false;
    const emit = (side: string | null | undefined, op: 0 | 1) => {
      for (const quad of parseSide(side)) {
        if (hasBlankNode(quad.subject) || hasBlankNode(quad.object) || hasBlankNode(quad.graph)) {
          sawBlankNode = true;
        }
        seq += 1;
        rows.push({
          seq,
          patch: ordinal,
          op,
          g: quad.graph ? termToNQuad(label(quad.graph)) : DEFAULT_GRAPH_COLUMN,
          s: termToNQuad(label(quad.subject)),
          p: termToNQuad(quad.predicate),
          o: termToNQuad(label(quad.object)),
        });
      }
    };

    // Deletions first: see the note above.
    emit(patch.deletions, 0);
    emit(patch.additions, 1);
    if (sawBlankNode) withBlankNodes.push(patch.$id);
  });

  if (withBlankNodes.length > 0) {
    caveats.push({
      kind: 'blank-nodes',
      patches: withBlankNodes,
      message:
        'Quads with blank nodes are labelled per patch, so a later patch cannot delete an earlier '
        + "patch's blank-node quad through the log. Reconstruction is exact for ground quads only.",
    });
  }
  if (inexact.length > 0) {
    caveats.push({
      kind: 'inexact-net-effect',
      patches: inexact,
      message:
        'One or more patches recorded netEffectExact=false, meaning their own quad sets understate '
        + 'what the update changed. The log cannot be more exact than the patches in it.',
    });
  }

  return { rows, patchIds, caveats };
}
