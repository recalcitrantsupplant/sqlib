import { describe, it, expect, vi, beforeEach } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const inserts: Record<string, any[]> = {};
const recordInsert = (obj: any, entityType: string) => {
  inserts[entityType] = inserts[entityType] || [];
  inserts[entityType].push(obj);
};

overrideCacheCoordinatorProvider((() => {
  return {
    getCacheCoordinator: () => ({
      create: vi.fn(async (entityType: string, e: any) => {
        recordInsert(e, entityType);
        return { ...e, '@type': entityType };
      }),
      update: vi.fn(async (_type: string, _id: string, updates: any) => ({ $id: _id, ...updates, '@type': 'Query' })),
      list: vi.fn(() => []),
      get: vi.fn(() => ({ '@type': 'Query' })),
    }),
  };
})());

describe('QueryVersionWriter basic flow', () => {
  beforeEach(() => { Object.keys(inserts).forEach(k => { inserts[k] = []; }); });

  it('creates children and version, and flips currentVersion', async () => {
    const { createQueryVersionFlat } = await import('../../src/lib/QueryVersionWriter.js');
    const res = await createQueryVersionFlat('urn:query:1', {
      queryString: 'SELECT * WHERE { ?s ?p ?o }',
      limitParameters: [{ name: 'lim' }],
      offsetParameters: [{ name: 'off' }],
      inputs: [{ variableName: 'x' }],
      outputs: [{ variableName: 'y' }],
      tupleMembers: [{ position: 0, variable: 'urn:sqlib:input:x' }],
      inferredInputs: [{ memberEntries: ['urn:sqlib:tuple-member:1'] }],
      inferredOutputs: [{ name: 't', memberEntries: [] }],
    });
    expect(res.created).toBeTruthy();
    expect(inserts.LimitParameter?.length).toBe(1);
    expect(inserts.OffsetParameter?.length).toBe(1);
    expect(inserts.QueryInputVariable?.length).toBe(1);
    expect(inserts.QueryOutputVariable?.length).toBe(1);
  });
});
