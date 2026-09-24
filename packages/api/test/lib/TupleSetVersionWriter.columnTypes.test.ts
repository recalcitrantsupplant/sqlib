import { describe, it, expect, vi, beforeEach } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

/**
 * `createTupleSetVersion` applies accepted column-type suggestions (issue
 * #208) after parsing and before anything is persisted — this covers that
 * wiring specifically, since `applyColumnTypes` itself is exercised directly
 * in `tupleContent.test.ts`.
 */

const created: Record<string, unknown>[] = [];

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    create: vi.fn(async (entityType: string, entity: Record<string, unknown>) => {
      created.push({ ...entity, '@type': entityType });
      return { ...entity, '@type': entityType };
    }),
    update: vi.fn(async (_type: string, id: string, updates: Record<string, unknown>) => ({ $id: id, ...updates })),
    get: vi.fn(() => null),
    list: vi.fn(() => []),
  }),
});

describe('createTupleSetVersion — column-type suggestions', () => {
  beforeEach(() => { created.length = 0; });

  it('promotes an accepted column before storing', async () => {
    const { createTupleSetVersion } = await import('../../src/lib/TupleSetVersionWriter.js');

    await createTupleSetVersion('urn:sqlib:tuple-set:s1', {
      contentString: 'pop\n2100000\n',
      sourceFormat: 'csv',
      columnTypes: { pop: 'xsd:integer' },
    });

    const stored = JSON.parse(String(created[0].contentString));
    expect(stored.results.bindings[0].pop).toEqual({
      type: 'literal',
      value: '2100000',
      datatype: 'http://www.w3.org/2001/XMLSchema#integer',
    });
  });

  it('stores plain strings when no column type is accepted', async () => {
    const { createTupleSetVersion } = await import('../../src/lib/TupleSetVersionWriter.js');

    await createTupleSetVersion('urn:sqlib:tuple-set:s1', {
      contentString: 'pop\n2100000\n',
      sourceFormat: 'csv',
    });

    const stored = JSON.parse(String(created[0].contentString));
    expect(stored.results.bindings[0].pop).toEqual({ type: 'literal', value: '2100000' });
  });

  it('rejects an accepted type a cell does not actually fit', async () => {
    const { createTupleSetVersion } = await import('../../src/lib/TupleSetVersionWriter.js');
    const { TupleContentError } = await import('../../src/lib/tupleContent.js');

    await expect(
      createTupleSetVersion('urn:sqlib:tuple-set:s1', {
        contentString: 'n\n42\nnope\n',
        sourceFormat: 'csv',
        columnTypes: { n: 'xsd:integer' },
      }),
    ).rejects.toThrow(TupleContentError);
  });
});
