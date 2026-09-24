import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    list: hoisted.list,
    get: hoisted.get,
    create: hoisted.create,
    update: hoisted.update,
    delete: hoisted.delete,
  }),
});

import { ArgumentSetService } from '../../src/lib/ArgumentSetService.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const service = new ArgumentSetService();

describe('ArgumentSetService', () => {
  const store = new Map<string, any>();
  const typeStore = new Map<string, any[]>();
  let getSpy: any;

  beforeEach(() => {
    store.clear();
    typeStore.clear();
    getSpy = hoisted.get.mockImplementation((id: string) => store.get(id) ?? null);
    hoisted.list.mockImplementation((type: string) => typeStore.get(type) ?? []);
    hoisted.update.mockImplementation(async (_type: string, id: string, updates: any) => {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...updates };
      store.set(id, updated);
      return updated;
    });
    hoisted.create.mockImplementation(async (_type: string, data: any) => data);
    hoisted.delete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports runtime payloads for version ids', async () => {
    store.set('binding1', {
      '$id': 'binding1',
      '@type': 'ArgumentTupleBinding',
      tupleSignature: 'varA',
      fallbackVariables: ['varA'],
      contentString: JSON.stringify({
        head: { vars: ['varA'] },
        results: { bindings: [{ varA: { type: 'literal', value: 'foo' } }] },
      }),
    });
    store.set('scalar1', {
      '$id': 'scalar1',
      '@type': 'ArgumentScalarBinding',
      parameterKind: 'limit',
      parameterName: 'page',
      numericValue: 100,
    });

    store.set('version1', {
      '$id': 'version1',
      '@type': 'ArgumentSetVersion',
      isPartOf: 'set1',
      version: 1,
      tupleBindings: ['binding1'],
      scalarBindings: ['scalar1'],
    });

    const payload = await service.exportRuntimePayload(['version1']);
    expect(payload.tupleList).toHaveLength(1);
    expect(payload.tupleList[0].head.vars).toEqual(['varA']);
    expect(payload.tupleList[0].arguments.bindings).toEqual([
      { varA: { type: 'literal', value: 'foo' } },
    ]);
    expect(payload.limits).toEqual([{ name: 'page', value: 100 }]);
    expect(payload.offsets).toEqual([]);
    expect(getSpy).toHaveBeenCalledWith('version1');
  });

  it('resolves argument set ids to their current versions', async () => {
    store.set('set1', {
      '$id': 'set1',
      '@type': 'ArgumentSet',
      name: 'Sample',
      argumentScope: 'query',
      targetEntity: 'urn:query:1',
      currentVersion: 'version1',
    });
    store.set('version1', {
      '$id': 'version1',
      '@type': 'ArgumentSetVersion',
      isPartOf: 'set1',
      version: 1,
      tupleBindings: [],
      scalarBindings: [],
    });

    const payload = await service.exportRuntimePayload(['set1']);
    expect(payload.tupleList).toHaveLength(0);
    expect(getSpy).toHaveBeenCalledWith('set1');
  });

  /*
   * Callers that record what a run executed — rather than merely execute it —
   * need the resolution on its own, before and apart from the values, so the
   * pin can be taken once and reused for every repeat (issue #246).
   */
  describe('resolveVersionIdForId', () => {
    beforeEach(() => {
      store.set('set1', {
        '$id': 'set1',
        '@type': 'ArgumentSet',
        name: 'Sample',
        argumentScope: 'query',
        targetEntity: 'urn:query:1',
        currentVersion: 'version1',
      });
      store.set('version1', {
        '$id': 'version1',
        '@type': 'ArgumentSetVersion',
        isPartOf: 'set1',
        version: 1,
      });
    });

    it('follows a set to its current version', () => {
      expect(service.resolveVersionIdForId('set1')).toBe('version1');
    });

    it('leaves a version id alone — it is already pinned', () => {
      expect(service.resolveVersionIdForId('version1')).toBe('version1');
    });

    it('refuses a set with no current version rather than guessing one', () => {
      store.set('set1', { ...store.get('set1'), currentVersion: null });

      expect(() => service.resolveVersionIdForId('set1')).toThrow('no current version');
    });

    it('refuses an id that names nothing', () => {
      expect(() => service.resolveVersionIdForId('missing')).toThrow('not found');
    });
  });
});
