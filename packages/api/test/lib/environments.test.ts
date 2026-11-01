/**
 * The pure parts of `lib/environments.ts`: resolution rules and the
 * group-ahead-of-parts check, over a stub cache.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { partsBehind, resolveVersionIn } from '../../src/lib/environments.js';

const LIB = 'urn:sqlib:library:a';
const entities = new Map<string, Record<string, unknown>>();

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: (id: string) => entities.get(id) ?? null,
    list: (type: string) => [...entities.values()].filter(e => e['@type'] === type),
  }),
  getEntityRepositories: () => ({}),
});

function put(entity: Record<string, unknown> & { $id: string }) {
  entities.set(entity.$id, entity);
}

beforeEach(() => {
  entities.clear();
  put({ $id: LIB, '@type': 'Library' });
  put({ $id: 'q1', '@type': 'Query', name: 'Q1', isPartOf: [LIB], currentVersion: 'q1v2' });
  put({ $id: 'q1v1', '@type': 'QueryVersion', isPartOf: 'q1' });
  put({ $id: 'q1v2', '@type': 'QueryVersion', isPartOf: 'q1' });
  put({ $id: 'part', '@type': 'Query', name: 'Part', isPartOf: [LIB], groupOnly: true, currentVersion: 'partv1' });
  put({ $id: 'partv1', '@type': 'QueryVersion', isPartOf: 'part' });
  put({ $id: 'n1', '@type': 'QueryNode', queryId: 'q1v2' });
  put({ $id: 'n2', '@type': 'QueryNode', queryId: 'partv1' });
  put({ $id: 'g', '@type': 'QueryGroup', name: 'G', isPartOf: LIB, currentVersion: 'gv1' });
  put({ $id: 'gv1', '@type': 'QueryGroupVersion', isPartOf: 'g', executionNodes: ['n1', 'n2'] });
  put({ $id: 'prod', '@type': 'Environment', name: 'prod', isPartOf: LIB, position: 1, versions: ['q1v1'] });
});

describe('resolveVersionIn', () => {
  it('follows the rules in docs/explanation/environments.md', () => {
    const q1 = entities.get('q1') as { $id: string };
    expect(resolveVersionIn(q1, null)).toMatchObject({ ok: true, version: 'q1v2' });
    expect(resolveVersionIn(q1, 'latest')).toMatchObject({ ok: true, version: 'q1v2' });
    expect(resolveVersionIn(q1, 'prod')).toMatchObject({ ok: true, version: 'q1v1' });
    expect(resolveVersionIn(q1, 'nope')).toMatchObject({ ok: false, status: 400 });
    const g = entities.get('g') as { $id: string };
    expect(resolveVersionIn(g, 'prod')).toMatchObject({ ok: false, status: 409 });
  });
});

describe('partsBehind', () => {
  it('lists parts the environment holds at another version, and skips groupOnly parts', () => {
    expect(partsBehind('gv1', { versions: ['q1v1'] })).toEqual([
      { node: 'n1', entity: 'q1', pinned: 'q1v2', inEnvironment: 'q1v1' },
    ]);
    expect(partsBehind('gv1', { versions: ['q1v2'] })).toEqual([]);
  });
});
