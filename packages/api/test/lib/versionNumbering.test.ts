import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Version numbering, which four writers used to each compute for themselves.
 *
 * Two of them did it by sorting and taking the last element, two by taking a
 * maximum. Those agree on every input, which is exactly why nobody noticed
 * there were two implementations — so the shared one gets the assertions the
 * copies never had.
 */

const hoisted = vi.hoisted(() => ({ entities: [] as Array<Record<string, unknown>> }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    list: (type: string) => hoisted.entities.filter((entity) => entity['@type'] === type),
  }),
}));

const { nextVersionNumber } = await import('../../src/lib/versionNumbering.js');

function version(type: string, parentId: string, number: number) {
  return { $id: `${parentId}:v${number}`, '@type': type, isPartOf: parentId, version: number };
}

beforeEach(() => {
  hoisted.entities.length = 0;
});

describe('nextVersionNumber', () => {
  it('starts at 1 when the parent has no versions', () => {
    expect(nextVersionNumber('TestVersion', 'urn:test:1')).toBe(1);
  });

  it('counts only the named parent’s versions', () => {
    hoisted.entities.push(
      version('TestVersion', 'urn:test:1', 1),
      version('TestVersion', 'urn:test:1', 2),
      version('TestVersion', 'urn:test:2', 7),
    );
    expect(nextVersionNumber('TestVersion', 'urn:test:1')).toBe(3);
  });

  it('counts only the named version type', () => {
    // Every version entity lives in one store, so filtering by parent alone
    // would let a DataGraphVersion decide a TestVersion's number.
    hoisted.entities.push(
      version('DataGraphVersion', 'urn:shared:1', 9),
      version('TestVersion', 'urn:shared:1', 1),
    );
    expect(nextVersionNumber('TestVersion', 'urn:shared:1')).toBe(2);
  });

  it('takes the highest number rather than the count', () => {
    // The gap is the point: deleting v2 must not make the next version a
    // second v3, because a version id that used to mean one thing would
    // quietly come to mean another.
    hoisted.entities.push(
      version('TestVersion', 'urn:test:1', 1),
      version('TestVersion', 'urn:test:1', 3),
    );
    expect(nextVersionNumber('TestVersion', 'urn:test:1')).toBe(4);
  });

  it('does not depend on the order the store returns', () => {
    hoisted.entities.push(
      version('TestVersion', 'urn:test:1', 3),
      version('TestVersion', 'urn:test:1', 1),
      version('TestVersion', 'urn:test:1', 2),
    );
    expect(nextVersionNumber('TestVersion', 'urn:test:1')).toBe(4);
  });

  it('does not reorder the list it was given', () => {
    // The two sort-based copies mutated the array handed to them by the cache.
    const listed = [
      version('TestVersion', 'urn:test:1', 3),
      version('TestVersion', 'urn:test:1', 1),
    ];
    hoisted.entities.push(...listed);
    nextVersionNumber('TestVersion', 'urn:test:1');
    expect(hoisted.entities.map((entity) => entity.version)).toEqual([3, 1]);
  });

  it('survives a version with no number rather than producing NaN', () => {
    hoisted.entities.push(
      version('TestVersion', 'urn:test:1', 2),
      { $id: 'broken', '@type': 'TestVersion', isPartOf: 'urn:test:1' },
    );
    expect(nextVersionNumber('TestVersion', 'urn:test:1')).toBe(3);
  });
});
