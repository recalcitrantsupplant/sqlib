/**
 * The change feed dispatches by entity.
 *
 * Over the real stores and the real API client, with only `fetch` scripted:
 * what matters is which requests go out. A rule-set change used to be handed to
 * the queries store, which asked for `GET /queries/<ruleSetId>`, swallowed the
 * 404, and left the rule-set editor holding a stale etag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLibraryRefresh, type EntityRefresher } from '@/composables/useLibraryRefresh';
import { useRuleSetsStore } from '@/composables/useRuleSetsStore';

const RULE_SET = 'urn:sqlib:rule-set:1';
const LIBRARY = 'urn:sqlib:library:1';

function ruleSet(dateModified: string) {
  return {
    id: RULE_SET,
    name: 'Closure',
    isPartOf: [LIBRARY],
    dateModified,
  };
}

function json(body: unknown, etag?: string) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(etag ? { etag } : {}) },
  });
}

describe('useLibraryRefresh', () => {
  let paths: string[];

  beforeEach(() => {
    paths = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes the rule-set store and its concurrency token for a rule-set change', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (path === '/rule-sets') return json([ruleSet('2026-10-02T10:00:00.000Z')]);
        if (path === `/rule-sets/${encodeURIComponent(RULE_SET)}`) {
          return json(ruleSet('2026-10-02T10:00:00.000Z'), '"2026-10-02T10:00:00.000Z"');
        }
        return new Response('not found', { status: 404 });
      })
    );

    const store = useRuleSetsStore();
    store.concurrency[RULE_SET] = '"stale"';

    await useLibraryRefresh().refreshEntities({
      changed: [{ entity: 'ruleSet', id: RULE_SET }],
      libraryId: LIBRARY,
    });

    expect(paths).toContain('/rule-sets');
    expect(paths).toContain(`/rule-sets/${encodeURIComponent(RULE_SET)}`);
    expect(paths.some((path) => path.startsWith('/queries'))).toBe(false);
    expect(store.ruleSets.value.map((item) => item.id)).toEqual([RULE_SET]);
    expect(store.concurrency[RULE_SET]).toBe('"2026-10-02T10:00:00.000Z"');
  });

  it('groups a batch per entity: one list reload per kind, one fetch per id', async () => {
    const calls: string[] = [];
    const registry: Record<string, () => EntityRefresher> = {
      query: () => ({
        reload: async () => calls.push('query:list'),
        refreshOne: async (id) => calls.push(`query:${id}`),
      }),
      ruleSet: () => ({
        reload: async () => calls.push('ruleSet:list'),
        refreshOne: async (id) => calls.push(`ruleSet:${id}`),
      }),
    };

    await useLibraryRefresh(registry).refreshEntities({
      changed: [
        { entity: 'query', id: 'q1' },
        { entity: 'query', id: 'q1' },
        { entity: 'query', id: 'q2' },
        { entity: 'ruleSet', id: 'r1' },
        { entity: 'rule', id: 'no-store' },
      ],
      open: { entity: 'ruleSet', id: 'r2' },
    });

    expect(calls.sort()).toEqual(
      ['query:list', 'query:q1', 'query:q2', 'ruleSet:list', 'ruleSet:r1', 'ruleSet:r2'].sort()
    );
  });

  it('does not refetch the open record twice when the batch already names it', async () => {
    const refreshOne = vi.fn(async () => undefined);
    const registry: Record<string, () => EntityRefresher> = {
      dataGraph: () => ({ reload: async () => undefined, refreshOne }),
    };

    await useLibraryRefresh(registry).refreshEntities({
      changed: [{ entity: 'dataGraph', id: 'g1' }],
      open: { entity: 'dataGraph', id: 'g1' },
    });

    expect(refreshOne).toHaveBeenCalledTimes(1);
  });
});
