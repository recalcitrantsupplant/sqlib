/**
 * The display-name cache behind the person chip: one call per tick for every
 * IRI on the screen, one call per IRI per session, and `null` for a person the
 * server has no name for.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPrincipalNameCache, NAMES_PER_CALL } from '@/lib/principalNames';

const ALICE = 'urn:sqlib:principal:user:alice';
const BOB = 'urn:sqlib:principal:user:bob';

describe('createPrincipalNameCache', () => {
  it('asks once for every IRI requested in the same tick', async () => {
    const fetchNames = vi.fn(async (iris: string[]) =>
      iris.filter((iri) => iri === ALICE).map((iri) => ({ iri, displayName: 'Alice Ng' })),
    );
    const cache = createPrincipalNameCache(fetchNames);

    expect(cache.nameOf(ALICE)).toBeUndefined();
    expect(cache.nameOf(BOB)).toBeUndefined();
    expect(cache.nameOf(ALICE)).toBeUndefined();
    await cache.settled();

    expect(fetchNames).toHaveBeenCalledTimes(1);
    expect(fetchNames).toHaveBeenCalledWith([ALICE, BOB]);
    expect(cache.nameOf(ALICE)).toBe('Alice Ng');
    expect(cache.nameOf(BOB)).toBeNull();
  });

  it('does not ask again for a name it holds', async () => {
    const fetchNames = vi.fn(async () => [{ iri: ALICE, displayName: 'Alice Ng' }]);
    const cache = createPrincipalNameCache(fetchNames);
    cache.nameOf(ALICE);
    await cache.settled();
    cache.nameOf(ALICE);
    await cache.settled();
    expect(fetchNames).toHaveBeenCalledTimes(1);
  });

  it('splits a large screen into calls of at most 100 IRIs', async () => {
    const fetchNames = vi.fn(async () => []);
    const cache = createPrincipalNameCache(fetchNames);
    for (let i = 0; i < NAMES_PER_CALL + 1; i++) cache.nameOf(`urn:sqlib:principal:user:${i}`);
    await cache.settled();
    expect(fetchNames.mock.calls.map(([iris]) => (iris as string[]).length)).toEqual([NAMES_PER_CALL, 1]);
  });

  it('records a failed lookup as unknown', async () => {
    const cache = createPrincipalNameCache(async () => {
      throw new Error('offline');
    });
    cache.nameOf(ALICE);
    await cache.settled();
    expect(cache.nameOf(ALICE)).toBeNull();
  });
});
