import { describe, it, expect, vi, beforeEach } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

// Mocks for CacheCoordinatorProvider and LDKit utils used by GroupVersionWriter
const inserts: Record<string, any[]> = {};
const recordInsert = (obj: any, entityType: string) => {
  inserts[entityType] = inserts[entityType] || [];
  inserts[entityType].push(obj);
};

const hoisted = vi.hoisted(() => {
  const versions: any[] = [];
  let group: any = null;
  let library: any = null;
  let query: any = null;

  return {
    create: vi.fn(async (entityType: string, entity: any) => {
      recordInsert(entity, entityType);
      return { ...entity, '@type': entityType };
    }),
    update: vi.fn(async (_type: string, id: string, updates: any) => ({ $id: id, ...updates, '@type': 'QueryGroupVersion' })),
    get: vi.fn((id: string) => {
      if (group && id === group.$id) return group;
      if (library && id === library.$id) return library;
      if (query && id === query.$id) return query;
      return versions.find(v => v.$id === id) || null;
    }),
    list: vi.fn((type: string) => {
      if (type === 'QueryVersion') return versions;
      if (type === 'QueryGroupVersion') return [];
      return [];
    }),
    setGroup(g: any) { group = g; },
    setLibrary(l: any) { library = l; },
    setQuery(q: any) { query = q; },
    setVersions(vs: any[]) { versions.splice(0, versions.length, ...vs); },
  };
});

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    list: hoisted.list,
    get: hoisted.get,
    create: hoisted.create,
    update: hoisted.update,
    delete: vi.fn(),
    // The writer resolves client-supplied references through this; here it is
    // backed by the same fixtures `get` serves.
    resolveExisting: async (id: string) => {
      const entity = hoisted.get(id) as { '@type'?: string } | null;
      return entity ? { type: entity['@type'], entity } : null;
    },
  }),
});

describe('GroupVersionWriter backend resolution', () => {
  beforeEach(() => {
    Object.keys(inserts).forEach(k => { inserts[k] = []; });
    hoisted.setGroup(null);
    hoisted.setLibrary(null);
    hoisted.setQuery(null);
    hoisted.setVersions([]);
  });

  it('resolves backend from QueryVersion.defaultBackend when node.backendId missing', async () => {
    hoisted.setGroup({ $id: 'urn:group:1', '@type': 'QueryGroup', isPartOf: 'urn:lib:1' });
    hoisted.setLibrary({ $id: 'urn:lib:1', '@type': 'Library', defaultBackend: 'urn:backend:lib' });
    hoisted.setVersions([
      { $id: 'urn:qv:1', '@type': 'QueryVersion', isPartOf: 'urn:query:1' }
    ]);
    hoisted.setQuery({ $id: 'urn:query:1', '@type': 'Query', defaultBackend: 'urn:backend:query' });

    const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');
    const { created } = await createGroupVersionFlat('urn:group:1', {
      executionNodes: [{ nodeType: 'QueryNode', queryId: 'urn:qv:1', id: 'urn:ui-temp:n1' }],
      edges: [],
    });

    expect(created).toBeTruthy();
    // Check that QueryNode entities were created with backendId = qv default
    const [first] = inserts.QueryNode || [];
    expect(first).toBeTruthy();
    expect(first.backendId).toBe('urn:backend:query');
  });

  it('falls back to Library.defaultBackend when version has none', async () => {
    hoisted.setGroup({ $id: 'urn:group:2', '@type': 'QueryGroup', isPartOf: 'urn:lib:2' });
    hoisted.setLibrary({ $id: 'urn:lib:2', '@type': 'Library', defaultBackend: 'urn:backend:lib2' });
    hoisted.setVersions([{ $id: 'urn:qv:2', '@type': 'QueryVersion' }]);

    const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');
    await createGroupVersionFlat('urn:group:2', {
      executionNodes: [{ nodeType: 'QueryNode', queryId: 'urn:qv:2', id: 'urn:ui-temp:n1' }],
      edges: [],
    });
    const [first] = inserts.QueryNode || [];
    expect(first).toBeTruthy();
    expect(first.backendId).toBe('urn:backend:lib2');
  });

  it('throws when backend cannot be resolved', async () => {
    // The query version resolves, so the backend is the only thing left that
    // cannot be found — neither named on the node nor defaulted anywhere.
    hoisted.setGroup({ $id: 'urn:group:3', '@type': 'QueryGroup' });
    hoisted.setLibrary(null as any);
    hoisted.setVersions([{ $id: 'urn:qv:3', '@type': 'QueryVersion' }]);

    const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');
    await expect(createGroupVersionFlat('urn:group:3', {
      executionNodes: [{ nodeType: 'QueryNode', queryId: 'urn:qv:3', id: 'urn:ui-temp:n1' }],
      edges: [],
    })).rejects.toThrow(/backendId.*could not be resolved/i);
  });
});
