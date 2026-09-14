/**
 * Which clock the patch log is ordered by.
 *
 * `orderPatchLog` orders on `(dateApplied ?? dateCreated, contentHash, $id)`,
 * and the first term is the one that carries a causal claim: when the quads
 * reached the store. Until `persist` actually wrote `dateApplied`, three of the
 * four writers fell through to `dateCreated` — stamped when the *record* was
 * written, with `serialiseSides` in between.
 *
 * That gap is not a constant. Canonicalisation is O(the patch), so a large
 * patch applied first can be written second, and a log ordered on write time
 * folds the two the wrong way round. This pins the clock rather than the fix:
 * whatever writes the record, the log has to be in the order the store saw.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as oxigraph from 'oxigraph';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { orderPatchLog } from '../../src/lib/patchLog.js';
import type { LdkitPatch } from '../../src/persistence/schemas/PatchSchema.js';

const BACKEND_ID = 'urn:sqlib:backend:patch-order-test';

/** The subject whose canonicalisation is made slow, standing in for a big patch. */
const SLOW_SUBJECT = 'http://ex/slow';

/**
 * The gate that makes the interleaving deterministic rather than timed.
 *
 * `entered` resolves when the slow patch reaches canonicalisation — which is
 * *after* its quads are in the store — and its serialisation then waits for
 * `release()`. So "landed first, written second" is arranged by the test rather
 * than raced for, and a busy CI box cannot reorder it.
 */
const gate = vi.hoisted(() => {
  let announceEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    announceEntered = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { entered, released, announceEntered, release: () => release() };
});

const { patchStore, patchRepo } = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    patchStore: store,
    patchRepo: {
      get: (id: string) => store.get(id) ?? null,
      list: () => [...store.values()],
      create: async (entity: Record<string, unknown>) => {
        // The repository stamps `dateCreated` itself, at the moment the record
        // is written — which is the whole point of this test.
        const record = { ...entity, '@type': 'Patch', dateCreated: new Date().toISOString() };
        store.set(entity.$id as string, record);
        return record;
      },
      update: async (id: string, updates: Record<string, unknown>) => {
        const current = store.get(id);
        if (!current) return null;
        const next = { ...current, ...updates };
        store.set(id, next);
        return next;
      },
      delete: async (id: string) => {
        store.delete(id);
      },
    },
  };
});

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({ Patch: patchRepo }),
  getCacheCoordinator: () => ({ get: () => null }),
}));

vi.mock('../../src/persistence/utils/BackendUtils.js', () => ({
  Backends: {
    findByIri: async (iri: string) =>
      iri === BACKEND_ID
        ? { $id: BACKEND_ID, name: 'Patch order test', backendType: BackendTypeIri.oxigraphEphemeral }
        : null,
  },
}));

/**
 * Canonicalisation, made expensive for one patch and free for the other.
 *
 * The real cost is RDFC-1.1 over the patch's own quads, so it is the patch that
 * decides it. Identity is enough for the rest: nothing here reads the canonical
 * form, and the two patches never tie on time.
 */
vi.mock('../../src/lib/rdfCanonicalizer.js', () => ({
  canonicalizeNQuads: async (nquads: string) => {
    if (nquads.includes(SLOW_SUBJECT)) {
      gate.announceEntered();
      await gate.released;
    }
    return nquads;
  },
}));

const { applyUpdate } = await import('../../src/lib/patchService.js');

function store(): oxigraph.Store {
  return oxigraphStoreManager.getEphemeralStore(BACKEND_ID)!;
}

/** Long enough that two `new Date()` calls either side of it cannot tie. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('the patch log is ordered by when patches landed', () => {
  beforeEach(() => {
    patchStore.clear();
    const fresh = oxigraphStoreManager.createEphemeralStore(BACKEND_ID);
    fresh.update('DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }');
  });

  it('folds the patch that landed first first, however long it took to write', async () => {
    // Applied first, written last: its canonicalisation is the slow one.
    const slow = applyUpdate({
      backendId: BACKEND_ID,
      updateString: `INSERT DATA { <${SLOW_SUBJECT}> <http://ex/p> "first" }`,
    });

    // Its quads are in the store and its record is not written yet.
    await gate.entered;
    await tick();

    const fast = await applyUpdate({
      backendId: BACKEND_ID,
      updateString: 'INSERT DATA { <http://ex/fast> <http://ex/p> "second" }',
    });

    await tick();
    gate.release();
    const first = await slow;

    // The record of the patch that landed first was written after the other's.
    expect(Date.parse(first.dateCreated!)).toBeGreaterThan(Date.parse(fast.dateCreated!));

    const { ordered, caveats } = orderPatchLog([...patchStore.values()] as unknown as LdkitPatch[]);
    expect(ordered.map((patch) => patch.$id)).toEqual([first.$id, fast.$id]);
    expect(caveats).toEqual([]);
  });

  it('gives every applied patch a time, whichever writer made it', async () => {
    await applyUpdate({
      backendId: BACKEND_ID,
      updateString: 'INSERT DATA { <http://ex/a> <http://ex/p> "1" }',
    });
    await applyUpdate({
      backendId: BACKEND_ID,
      updateString: 'INSERT DATA { <http://ex/b> <http://ex/p> "2" }',
    });

    const stored = [...patchStore.values()] as unknown as LdkitPatch[];
    expect(stored).toHaveLength(2);
    for (const patch of stored) {
      expect(patch.patchStatus).toBe('applied');
      expect(Number.isFinite(Date.parse(patch.dateApplied!))).toBe(true);
      // It landed before the record of it was written, never after.
      expect(Date.parse(patch.dateApplied!)).toBeLessThanOrEqual(Date.parse(patch.dateCreated!));
    }

    // Nothing about this log is undetermined, so the fold reports no caveat.
    expect(orderPatchLog(stored).caveats).toEqual([]);
    expect(store().size).toBe(2);
  });
});
