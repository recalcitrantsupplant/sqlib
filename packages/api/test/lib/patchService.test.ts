/**
 * The parts of the patch service that no route exercises: the blank-node path,
 * the log's honesty about exactness, and the preview sweep.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as oxigraph from 'oxigraph';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { EPHEMERAL_BACKEND_ID, LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';

const BACKEND_ID = 'urn:sqlib:backend:patch-service-test';
const READ_ONLY_BACKEND_ID = 'urn:sqlib:backend:patch-service-readonly';

const { patchStore, patchRepo } = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    patchStore: store,
    patchRepo: {
      get: (id: string) => store.get(id) ?? null,
      list: () => [...store.values()],
      create: async (entity: Record<string, unknown>) => {
        const record = { dateCreated: new Date().toISOString(), ...entity, '@type': 'Patch' };
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
    findByIri: async (iri: string) => {
      if (iri === BACKEND_ID) {
        return { $id: BACKEND_ID, name: 'Service test', backendType: BackendTypeIri.oxigraphEphemeral };
      }
      if (iri === READ_ONLY_BACKEND_ID) {
        return {
          $id: READ_ONLY_BACKEND_ID,
          name: 'Reference data',
          backendType: BackendTypeIri.oxigraphMemory,
          oxigraphConfig: { storeType: 'ephemeral', mode: 'readOnly' },
        };
      }
      return null;
    },
  },
}));

const { applyUpdate, previewUpdate, revertPatch, sweepPreviewedPatches, PatchTargetError } = await import(
  '../../src/lib/patchService.js'
);

function store(): oxigraph.Store {
  return oxigraphStoreManager.getEphemeralStore(BACKEND_ID)!;
}

beforeEach(() => {
  patchStore.clear();
  const fresh = oxigraphStoreManager.createEphemeralStore(BACKEND_ID);
  fresh.update('DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }');
  fresh.load('<http://ex/a> <http://ex/p> <http://ex/b> .\n', { format: 'application/n-quads' });
});

describe('blank nodes', () => {
  it('applies a patch that ground SPARQL could not express', async () => {
    const patch = await applyUpdate({
      backendId: BACKEND_ID,
      updateString: 'INSERT { ?s <http://ex/about> [ <http://ex/of> ?o ] } WHERE { ?s <http://ex/p> ?o }',
    });

    // `DELETE DATA` forbids blank nodes, so this went through the store API —
    // which is only possible because the backend is in process.
    expect(patch.applyMode).toBe('store');
    expect(patch.containsBnodes).toBe(true);
    expect(patch.revertible).toBe(false);
    expect(store().size).toBe(3);
  });

  it('refuses to revert one, rather than re-minting nodes and calling it undone', async () => {
    const patch = await applyUpdate({
      backendId: BACKEND_ID,
      updateString: 'INSERT { ?s <http://ex/about> [ <http://ex/of> ?o ] } WHERE { ?s <http://ex/p> ?o }',
    });

    await expect(revertPatch(patch.$id)).rejects.toBeInstanceOf(PatchTargetError);
  });

  it('keeps the labels it derived with, since canonicalising would rename them', async () => {
    const patch = await applyUpdate({
      backendId: BACKEND_ID,
      updateString: 'INSERT DATA { _:fresh <http://ex/p> <http://ex/o> }',
    });

    expect(patch.additions).toMatch(/^_:/);
  });
});

describe('the preview sweep', () => {
  it('drops previews nobody applied and keeps the log', async () => {
    const previewed = await previewUpdate({
      backendId: BACKEND_ID,
      updateString: 'INSERT DATA { <http://ex/x> <http://ex/p> <http://ex/y> }',
    });
    const applied = await applyUpdate({
      backendId: BACKEND_ID,
      updateString: 'INSERT DATA { <http://ex/q> <http://ex/p> <http://ex/r> }',
    });

    // An hour later, from the sweeper's point of view.
    const swept = await sweepPreviewedPatches(60 * 60 * 1000, Date.now() + 2 * 60 * 60 * 1000);

    expect(swept).toBe(1);
    expect(patchStore.has(previewed.$id)).toBe(false);
    expect(patchStore.has(applied.$id)).toBe(true);
  });

  it('leaves a preview that is still warm', async () => {
    await previewUpdate({
      backendId: BACKEND_ID,
      updateString: 'INSERT DATA { <http://ex/x> <http://ex/p> <http://ex/y> }',
    });

    expect(await sweepPreviewedPatches(60 * 60 * 1000)).toBe(0);
  });
});

describe('targets that cannot host a patch', () => {
  const INSERT = 'INSERT DATA { <http://ex/a> <http://ex/p> <http://ex/b> }';

  it('refuses the library storage backend', async () => {
    // It holds the patch log itself, among everything else.
    await expect(
      previewUpdate({ backendId: LIBRARY_STORAGE_BACKEND_ID, updateString: INSERT }),
    ).rejects.toThrow(/cannot be patched/);
  });

  it('refuses the per-request ephemeral backend', async () => {
    // Its store is discarded with the request, so the patch would describe a
    // store nobody can read back.
    await expect(previewUpdate({ backendId: EPHEMERAL_BACKEND_ID, updateString: INSERT })).rejects.toThrow(
      /no state to patch/,
    );
  });

  it('404s an unknown backend', async () => {
    await expect(
      previewUpdate({ backendId: 'urn:sqlib:backend:nope', updateString: INSERT }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('a read-only in-memory backend', () => {
  it('refuses to be written to, because the next reload would undo it', async () => {
    // `oxigraphMemory` in `readOnly` mode is hydrated from data graphs, so a
    // patch applied to it survives only until the next reload — a worse outcome
    // than refusing the write.
    await expect(
      applyUpdate({
        backendId: READ_ONLY_BACKEND_ID,
        updateString: 'INSERT DATA { <http://ex/x> <http://ex/p> <http://ex/y> }',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
