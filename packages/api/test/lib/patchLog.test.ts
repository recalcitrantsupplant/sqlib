/**
 * Turning the stored `Patch` log into the rows the sink's SQL folds.
 *
 * Two things are being argued here rather than merely exercised, and both are
 * properties the fold's correctness rests on: what order the log is in, and
 * which quads the fold can be trusted about.
 */

import { describe, expect, it } from 'vitest';
import { buildPatchLog, orderPatchLog, PATCH_LOG_STATUSES } from '../../src/lib/patchLog.js';
import type { LdkitPatch } from '../../src/persistence/schemas/PatchSchema.js';

const A = '<http://example.org/a>';
const P = '<http://example.org/p>';

function patch(fields: Partial<LdkitPatch> & { $id: string }): LdkitPatch {
  return {
    isPartOf: 'urn:sqlib:backend:one',
    additions: '',
    deletions: '',
    additionCount: 0,
    deletionCount: 0,
    patchStatus: 'applied',
    applyMode: 'ground-sparql',
    revertible: true,
    contentHash: `hash-${fields.$id}`,
    sourceKind: 'updateString',
    ...fields,
  } as LdkitPatch;
}

describe('PATCH_LOG_STATUSES', () => {
  it('holds the statuses whose quads reached the store, and only those', () => {
    expect([...PATCH_LOG_STATUSES].sort()).toEqual(['applied', 'reverted']);
  });
});

describe('orderPatchLog', () => {
  it('orders by dateApplied, falling back to dateCreated', () => {
    const ordering = orderPatchLog([
      patch({ $id: 'p:2', dateCreated: '2026-01-02T00:00:00.000Z' }),
      patch({ $id: 'p:1', dateCreated: '2026-01-01T00:00:00.000Z', dateApplied: '2026-01-03T00:00:00.000Z' }),
    ]);
    // p:1 was created first and applied last, and it is the apply that put its
    // quads in the store.
    expect(ordering.ordered.map((entry) => entry.$id)).toEqual(['p:2', 'p:1']);
    // p:2 is placed by a clock that means something else, which is the whole
    // point of the fallback being a fallback.
    expect(ordering.caveats.map((caveat) => caveat.kind)).toEqual(['assumed-apply-time']);
  });

  it('says so when a log patch is placed by dateCreated rather than dateApplied', () => {
    const ordering = orderPatchLog([
      patch({ $id: 'p:applied', dateCreated: '2026-01-01T00:00:00.000Z', dateApplied: '2026-01-04T00:00:00.000Z' }),
      // Stored before dateApplied was written: created when the diff was
      // previewed, applied whenever the approval came.
      patch({ $id: 'p:legacy', dateCreated: '2026-01-02T00:00:00.000Z' }),
    ]);
    const caveat = ordering.caveats.find((entry) => entry.kind === 'assumed-apply-time');
    expect(caveat?.patches).toEqual(['p:legacy']);
    // And it is not reported as undated: it has a stamp, it is the wrong one.
    expect(ordering.caveats.map((entry) => entry.kind)).not.toContain('undated');
  });

  it('leaves a fully dated log with no caveat', () => {
    const ordering = orderPatchLog([
      patch({ $id: 'p:1', dateCreated: '2026-01-01T00:00:00.000Z', dateApplied: '2026-01-01T00:00:01.000Z' }),
      patch({ $id: 'p:2', dateCreated: '2026-01-02T00:00:00.000Z', dateApplied: '2026-01-02T00:00:01.000Z' }),
    ]);
    expect(ordering.caveats).toEqual([]);
  });

  it('is deterministic when timestamps tie, and says the tiebreak is arbitrary', () => {
    const same = '2026-01-01T00:00:00.000Z';
    const first = orderPatchLog([
      patch({ $id: 'p:b', dateApplied: same, contentHash: 'zzz' }),
      patch({ $id: 'p:a', dateApplied: same, contentHash: 'aaa' }),
    ]);
    const reversed = orderPatchLog([
      patch({ $id: 'p:a', dateApplied: same, contentHash: 'aaa' }),
      patch({ $id: 'p:b', dateApplied: same, contentHash: 'zzz' }),
    ]);

    expect(first.ordered.map((entry) => entry.$id)).toEqual(['p:a', 'p:b']);
    // The property that matters: the same log reconstructs the same way
    // whatever order it arrives in.
    expect(reversed.ordered.map((entry) => entry.$id)).toEqual(first.ordered.map((entry) => entry.$id));

    expect(first.caveats).toHaveLength(1);
    expect(first.caveats[0]!.kind).toBe('tied-timestamp');
    expect(first.caveats[0]!.patches.sort()).toEqual(['p:a', 'p:b']);
  });

  it('does not call a tie between identical patches ambiguous', () => {
    const same = '2026-01-01T00:00:00.000Z';
    // Identical add and delete sets fold to the same state whichever way round
    // they go, so there is nothing to warn a caller about.
    const ordering = orderPatchLog([
      patch({ $id: 'p:a', dateApplied: same, contentHash: 'identical' }),
      patch({ $id: 'p:b', dateApplied: same, contentHash: 'identical' }),
    ]);
    expect(ordering.caveats).toEqual([]);
  });

  it('folds an undated patch last, and says so', () => {
    const ordering = orderPatchLog([
      patch({ $id: 'p:undated' }),
      patch({ $id: 'p:dated', dateApplied: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(ordering.ordered.map((entry) => entry.$id)).toEqual(['p:dated', 'p:undated']);
    expect(ordering.caveats.map((caveat) => caveat.kind)).toEqual(['undated']);
  });

  it('orders two undated patches by content rather than by how they arrived', () => {
    // `Infinity - Infinity` is NaN, which sort reads as "equal" — so the
    // contentHash and $id tiebreaks never ran and the order was the
    // repository's, which promises none. The caveat above says "in content
    // order"; this is that claim.
    const first = orderPatchLog([
      patch({ $id: 'p:b', contentHash: 'zzz' }),
      patch({ $id: 'p:a', contentHash: 'aaa' }),
    ]);
    const reversed = orderPatchLog([
      patch({ $id: 'p:a', contentHash: 'aaa' }),
      patch({ $id: 'p:b', contentHash: 'zzz' }),
    ]);
    expect(first.ordered.map((entry) => entry.$id)).toEqual(['p:a', 'p:b']);
    expect(reversed.ordered.map((entry) => entry.$id)).toEqual(['p:a', 'p:b']);
  });

  it('folds a revert after the patch it undoes when their timestamps tie', () => {
    const same = '2026-01-01T00:00:00.000Z';
    // Applied and reverted inside one millisecond. The key alone puts the
    // revert first — its contentHash sorts lower — and a fold in that order
    // returns the state as though the revert never happened.
    const ordering = orderPatchLog([
      patch({ $id: 'p:target', dateApplied: same, contentHash: 'zzz' }),
      patch({
        $id: 'p:revert',
        dateApplied: same,
        contentHash: 'aaa',
        sourceKind: 'revert',
        inverseOf: 'p:target',
      }),
    ]);
    expect(ordering.ordered.map((entry) => entry.$id)).toEqual(['p:target', 'p:revert']);
    // inverseOf is a recorded fact, so there is nothing arbitrary left to warn
    // about.
    expect(ordering.caveats).toEqual([]);
  });

  it('folds a revert after its target even when the clocks disagree, and says they do', () => {
    const ordering = orderPatchLog([
      patch({ $id: 'p:target', dateApplied: '2026-01-02T00:00:00.000Z' }),
      patch({
        $id: 'p:revert',
        dateApplied: '2026-01-01T00:00:00.000Z',
        sourceKind: 'revert',
        inverseOf: 'p:target',
      }),
    ]);
    expect(ordering.ordered.map((entry) => entry.$id)).toEqual(['p:target', 'p:revert']);
    const caveat = ordering.caveats.find((entry) => entry.kind === 'revert-before-target');
    expect(caveat?.patches).toEqual(['p:target', 'p:revert']);
  });

  it('keeps a revert of a revert behind both of them', () => {
    const same = '2026-01-01T00:00:00.000Z';
    const ordering = orderPatchLog([
      patch({ $id: 'p:undo-undo', dateApplied: same, contentHash: 'a', sourceKind: 'revert', inverseOf: 'p:undo' }),
      patch({ $id: 'p:undo', dateApplied: same, contentHash: 'b', sourceKind: 'revert', inverseOf: 'p:target' }),
      patch({ $id: 'p:target', dateApplied: same, contentHash: 'c' }),
    ]);
    expect(ordering.ordered.map((entry) => entry.$id)).toEqual(['p:target', 'p:undo', 'p:undo-undo']);
  });

  it('leaves a revert alone when its target is not in this log', () => {
    // `previewed` and `failed` patches are filtered out before this, and a
    // revert whose target is not here has nothing to be placed against.
    const ordering = orderPatchLog([
      patch({ $id: 'p:revert', dateApplied: '2026-01-02T00:00:00.000Z', sourceKind: 'revert', inverseOf: 'p:elsewhere' }),
      patch({ $id: 'p:other', dateApplied: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(ordering.ordered.map((entry) => entry.$id)).toEqual(['p:other', 'p:revert']);
    expect(ordering.caveats).toEqual([]);
  });

  it('returns every patch once even if the links form a cycle', () => {
    // `revertPatch` cannot write this — it names a patch that is already
    // applied — but a fold that dropped or repeated a patch on bad data would
    // be worse than one that ordered it oddly.
    const same = '2026-01-01T00:00:00.000Z';
    const ordering = orderPatchLog([
      patch({ $id: 'p:a', dateApplied: same, contentHash: 'a', inverseOf: 'p:b' }),
      patch({ $id: 'p:b', dateApplied: same, contentHash: 'b', inverseOf: 'p:a' }),
      patch({ $id: 'p:c', dateApplied: same, contentHash: 'c' }),
    ]);
    expect(ordering.ordered.map((entry) => entry.$id).sort()).toEqual(['p:a', 'p:b', 'p:c']);
  });

  it('places a revert against its own target and moves nothing else', () => {
    const ordering = orderPatchLog([
      patch({ $id: 'p:1', dateApplied: '2026-01-01T00:00:00.000Z' }),
      patch({ $id: 'p:2', dateApplied: '2026-01-02T00:00:00.000Z' }),
      patch({
        $id: 'p:revert-of-1',
        dateApplied: '2026-01-03T00:00:00.000Z',
        sourceKind: 'revert',
        inverseOf: 'p:1',
      }),
    ]);
    // The revert is already after its target, so the key order stands: a revert
    // does not jump back to sit beside what it undoes.
    expect(ordering.ordered.map((entry) => entry.$id)).toEqual(['p:1', 'p:2', 'p:revert-of-1']);
  });

  it('treats an unparseable date as no date rather than as the epoch', () => {
    const ordering = orderPatchLog([
      patch({ $id: 'p:junk', dateApplied: 'not a date' }),
      patch({ $id: 'p:dated', dateApplied: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(ordering.ordered.map((entry) => entry.$id)).toEqual(['p:dated', 'p:junk']);
  });
});

describe('buildPatchLog', () => {
  it('emits deletions before additions within one patch', () => {
    const { rows } = buildPatchLog([
      patch({
        $id: 'p:1',
        dateApplied: '2026-01-01T00:00:00.000Z',
        deletions: `${A} ${P} "old" .\n`,
        additions: `${A} ${P} "new" .\n`,
      }),
    ]);
    expect(rows.map((row) => [row.op, row.o])).toEqual([
      [0, '"old"'],
      [1, '"new"'],
    ]);
    // A quad both sides name has to survive its own patch, which is only true
    // in this order.
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
  });

  it('numbers patches from one, in log order, and reports the mapping', () => {
    const { rows, patchIds } = buildPatchLog([
      patch({ $id: 'p:second', dateApplied: '2026-01-02T00:00:00.000Z', additions: `${A} ${P} "b" .\n` }),
      patch({ $id: 'p:first', dateApplied: '2026-01-01T00:00:00.000Z', additions: `${A} ${P} "a" .\n` }),
    ]);
    expect(patchIds).toEqual(['p:first', 'p:second']);
    expect(rows.map((row) => [row.patch, row.o])).toEqual([
      [1, '"a"'],
      [2, '"b"'],
    ]);
  });

  it('numbers a same-millisecond revert after the patch it undoes', () => {
    const same = '2026-01-01T00:00:00.000Z';
    const { rows, patchIds } = buildPatchLog([
      patch({
        $id: 'p:revert',
        dateApplied: same,
        contentHash: 'aaa',
        sourceKind: 'revert',
        inverseOf: 'p:target',
        deletions: `${A} ${P} "x" .\n`,
      }),
      patch({ $id: 'p:target', dateApplied: same, contentHash: 'zzz', additions: `${A} ${P} "x" .\n` }),
    ]);
    expect(patchIds).toEqual(['p:target', 'p:revert']);
    // The add is seq 1 and the delete seq 2, so last-write-wins leaves the quad
    // out — which is what a reverted patch means. The other order returns it.
    expect(rows.map((row) => [row.seq, row.patch, row.op])).toEqual([
      [1, 1, 1],
      [2, 2, 0],
    ]);
  });

  it('writes a default-graph quad with an empty graph column', () => {
    const { rows } = buildPatchLog([
      patch({ $id: 'p:1', dateApplied: '2026-01-01T00:00:00.000Z', additions: `${A} ${P} "x" .\n` }),
    ]);
    expect(rows[0]!.g).toBe('');
  });

  it('carries a named graph through as its N-Triples term', () => {
    const { rows } = buildPatchLog([
      patch({
        $id: 'p:1',
        dateApplied: '2026-01-01T00:00:00.000Z',
        additions: `${A} ${P} "x" <http://example.org/g> .\n`,
      }),
    ]);
    expect(rows[0]!.g).toBe('<http://example.org/g>');
  });

  it('qualifies a blank-node label by its patch, so two patches cannot collide', () => {
    // Both sides of a patch are canonical N-Quads, so RDFC-1.1 hands both of
    // these the same label for what are two unrelated nodes. Folding them
    // together would let the second patch retract the first patch's quad.
    const { rows, caveats } = buildPatchLog([
      patch({ $id: 'p:1', dateApplied: '2026-01-01T00:00:00.000Z', additions: `_:c14n0 ${P} "x" .\n` }),
      patch({ $id: 'p:2', dateApplied: '2026-01-02T00:00:00.000Z', deletions: `_:c14n0 ${P} "x" .\n` }),
    ]);
    expect(rows.map((row) => row.s)).toEqual(['_:p1.c14n0', '_:p2.c14n0']);
    expect(caveats.map((caveat) => caveat.kind)).toContain('blank-nodes');
    expect(caveats.find((caveat) => caveat.kind === 'blank-nodes')!.patches).toEqual(['p:1', 'p:2']);
  });

  it('leaves a ground log with no blank-node caveat', () => {
    const { caveats } = buildPatchLog([
      patch({ $id: 'p:1', dateApplied: '2026-01-01T00:00:00.000Z', additions: `${A} ${P} "x" .\n` }),
    ]);
    expect(caveats).toEqual([]);
  });

  it('passes on a patch that recorded an inexact net effect', () => {
    const { caveats } = buildPatchLog([
      patch({
        $id: 'p:1',
        dateApplied: '2026-01-01T00:00:00.000Z',
        additions: `${A} ${P} "x" .\n`,
        netEffectExact: false,
      }),
    ]);
    expect(caveats.map((caveat) => caveat.kind)).toEqual(['inexact-net-effect']);
  });

  it('handles a patch with both sides empty', () => {
    const { rows, patchIds } = buildPatchLog([
      patch({ $id: 'p:1', dateApplied: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(rows).toEqual([]);
    // It still occupies an ordinal: a caller can travel to a patch that
    // changed nothing, and gets the state as it stood.
    expect(patchIds).toEqual(['p:1']);
  });

  it('parses a triple term rather than failing on RDF 1.2 syntax', () => {
    const { rows } = buildPatchLog([
      patch({
        $id: 'p:1',
        dateApplied: '2026-01-01T00:00:00.000Z',
        additions: `${A} ${P} <<( ${A} ${P} "x" )>> .\n`,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.o).toBe(`<<( ${A} ${P} "x" )>>`);
  });
});
