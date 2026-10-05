import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCacheCoordinator } from '../../src/lib/CacheCoordinatorProvider.js';
import { getPersistenceAdapter } from '../../src/persistence/adapterRegistry.js';
import {
  deleteLimitParameter,
  findLimitParameterById,
  findLimitParameterByName,
} from '../../src/persistence/utils/LimitParameterUtils.js';
import { installFakePersistenceAdapter } from './fakePersistenceAdapter.js';

const first = { $id: 'urn:sqlib:limitparameter:1', name: '1' };
const second = { $id: 'urn:sqlib:limitparameter:2', name: '2' };

describe('FakePersistenceAdapter', () => {
  let adapter: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;
  let writeThroughBefore: string | undefined;

  beforeEach(async () => {
    writeThroughBefore = process.env.CACHE_WRITE_THROUGH;
    adapter = await installFakePersistenceAdapter([
      { type: 'LimitParameter', entity: first },
      { type: 'LimitParameter', entity: second },
    ]);
  });
  afterEach(() => adapter.restore());

  it('is the adapter the app resolves once installed', () => {
    expect(getPersistenceAdapter()).toBe(adapter);
  });

  it('boot-loads the real coordinator from the seed', () => {
    expect(getCacheCoordinator().get(first.$id)).toMatchObject({ name: '1' });
  });

  it('receives the coordinator\'s writes', async () => {
    await getCacheCoordinator().create('LimitParameter', { $id: 'urn:sqlib:limitparameter:3', name: '3' } as never);
    expect(adapter.get('urn:sqlib:limitparameter:3')).toMatchObject({ name: '3' });
  });

  it('serves the real repository functions through the real coordinator', async () => {
    expect(await findLimitParameterById(first.$id)).toMatchObject({ name: '1' });
    expect(await findLimitParameterByName('2')).toMatchObject({ $id: second.$id });
    expect(await findLimitParameterById('urn:sqlib:limitparameter:missing')).toBeNull();
  });

  it('records writes so a test can assert on what was stored', async () => {
    await deleteLimitParameter(first.$id);
    expect(adapter.get(first.$id)).toBeUndefined();
    expect(adapter.all('LimitParameter')).toHaveLength(1);
  });

  it('answers a lookup under the wrong type with null, as the store does', async () => {
    expect(await adapter.findByIri('OffsetParameter', first.$id)).toBeNull();
  });

  it('clears a field patched to null and refuses a second insert of one id', async () => {
    await adapter.update('LimitParameter', first.$id, { name: null } as never);
    expect(adapter.get(first.$id)).not.toHaveProperty('name');
    await expect(adapter.insert('LimitParameter', first as never)).rejects.toThrow(/already exists/);
  });

  it('puts the real adapter back on restore', () => {
    adapter.restore();
    expect(getPersistenceAdapter()).not.toBe(adapter);
    expect(process.env.CACHE_WRITE_THROUGH).toBe(writeThroughBefore);
  });

  it('hands out copies, so a caller mutating a result cannot edit the store', async () => {
    const found = await adapter.findByIri('LimitParameter', first.$id);
    (found as { name: string }).name = 'mutated';
    expect(adapter.get(first.$id)).toMatchObject({ name: '1' });
  });
});
