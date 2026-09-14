import { describe, it, expect, beforeEach } from 'vitest';
import { ref } from 'vue';
import {
  useCallableDrafts,
  CALLABLE_DRAFTS_STORAGE_KEY,
  type CallableDraft,
  type CallableDraftInput,
} from '@/composables/useCallableDrafts';

function draft(overrides: Partial<CallableDraft> = {}): CallableDraftInput {
  return {
    id: 'urn:ui-temp:order-detail',
    libraryId: 'urn:lib:storefront',
    type: 'query',
    name: 'Order detail',
    description: null,
    queryString: 'SELECT * WHERE { ?s ?p ?o }',
    resultKind: 'BINDINGS',
    inputTuples: [['orderId']],
    limitParameters: [],
    offsetParameters: [],
    outputs: ['?orderId'],
    basedOn: null,
    ...overrides,
  };
}

describe('useCallableDrafts', () => {
  beforeEach(() => {
    localStorage.clear();
    useCallableDrafts().clear();
  });

  it('round-trips a draft through storage', () => {
    const store = useCallableDrafts();
    store.save(draft());

    const reloaded = useCallableDrafts();
    reloaded.reload();
    expect(reloaded.allDrafts.value).toHaveLength(1);
    expect(reloaded.get('urn:ui-temp:order-detail')?.name).toBe('Order detail');
  });

  it('stamps an updatedAt', () => {
    const store = useCallableDrafts();
    store.save(draft());
    expect(store.get('urn:ui-temp:order-detail')?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('replaces rather than duplicates when the same id is saved again', () => {
    const store = useCallableDrafts();
    store.save(draft());
    store.save(draft({ name: 'Order detail v2' }));

    expect(store.allDrafts.value).toHaveLength(1);
    expect(store.get('urn:ui-temp:order-detail')?.name).toBe('Order detail v2');
  });

  it('removes a draft — this is what saving does once the version lands', () => {
    const store = useCallableDrafts();
    store.save(draft());
    store.remove('urn:ui-temp:order-detail');

    expect(store.allDrafts.value).toEqual([]);
    expect(JSON.parse(localStorage.getItem(CALLABLE_DRAFTS_STORAGE_KEY)!)).toEqual([]);
  });

  it('scopes to one library, because a Build session is one library', () => {
    const store = useCallableDrafts();
    store.save(draft());
    store.save(draft({ id: 'urn:ui-temp:other', libraryId: 'urn:lib:other' }));

    const scoped = useCallableDrafts(ref('urn:lib:storefront'));
    expect(scoped.drafts.value.map((d) => d.id)).toEqual(['urn:ui-temp:order-detail']);
  });

  it('every consumer sees the same list', () => {
    const a = useCallableDrafts();
    const b = useCallableDrafts();
    a.save(draft());
    // The header count, the rows and Save are three views of one thing; if
    // they could disagree the tool receipts would stop being an audit trail.
    expect(b.allDrafts.value).toHaveLength(1);
  });

  it('survives corrupt storage rather than taking the screen down', () => {
    localStorage.setItem(CALLABLE_DRAFTS_STORAGE_KEY, '{ not json');
    const store = useCallableDrafts();
    store.reload();
    expect(store.allDrafts.value).toEqual([]);
  });

  it('drops entries that are not drafts and keeps the ones that are', () => {
    localStorage.setItem(
      CALLABLE_DRAFTS_STORAGE_KEY,
      JSON.stringify([{ nonsense: true }, { ...draft(), updatedAt: '2026-08-01T00:00:00Z' }])
    );
    const store = useCallableDrafts();
    store.reload();
    expect(store.allDrafts.value).toHaveLength(1);
  });

  describe('the kind/section split', () => {
    it('defaults a record with no kind to a query draft, so nothing already saved breaks', () => {
      // Exactly the shape written before scratch existed.
      localStorage.setItem(
        CALLABLE_DRAFTS_STORAGE_KEY,
        JSON.stringify([{ ...draft(), updatedAt: '2026-08-01T00:00:00Z' }])
      );
      const store = useCallableDrafts();
      store.reload();

      const restored = store.get('urn:ui-temp:order-detail')!;
      expect(restored.kind).toBe('draft');
      expect(restored.section).toBe('query');
      // A record that predates createdAt is dated by its last write, not by now.
      expect(restored.createdAt).toBe('2026-08-01T00:00:00Z');
    });

    it('keeps createdAt across edits — the sidebar shows a scratch item its age', () => {
      const store = useCallableDrafts();
      store.save(draft({ kind: 'scratch', createdAt: '2026-08-01T00:00:00Z' }));
      store.save(draft({ kind: 'scratch', name: 'edited' }));

      const saved = store.get('urn:ui-temp:order-detail')!;
      expect(saved.createdAt).toBe('2026-08-01T00:00:00Z');
      expect(saved.kind).toBe('scratch');
      expect(saved.updatedAt).not.toBe('2026-08-01T00:00:00Z');
    });

    it('mirrors a query body between queryString and body, whichever was written', () => {
      const store = useCallableDrafts();
      store.save(draft({ kind: 'scratch', section: 'query', body: 'ASK { ?s ?p ?o }' }));

      const saved = store.get('urn:ui-temp:order-detail')!;
      // The Build screen reads queryString, the section-agnostic sidebar reads
      // body. One write path, so the two cannot drift apart.
      expect(saved.queryString).toBe('ASK { ?s ?p ?o }');
      expect(saved.body).toBe('ASK { ?s ?p ?o }');
    });

    it('carries a non-query payload through body untouched', () => {
      const store = useCallableDrafts();
      store.save(draft({
        id: 'urn:ui-temp:ruleset',
        kind: 'scratch',
        section: 'rule',
        queryString: null,
        body: { dataBlocks: ['a'], rules: ['b'] },
      }));

      expect(store.get('urn:ui-temp:ruleset')?.body).toEqual({ dataBlocks: ['a'], rules: ['b'] });
    });

    it('lists scratch for one section, newest first', () => {
      const store = useCallableDrafts();
      store.save(draft({ id: 'a', kind: 'scratch', section: 'query' }));
      store.save(draft({ id: 'b', kind: 'scratch', section: 'query' }));
      store.save(draft({ id: 'c', kind: 'scratch', section: 'rule' }));
      store.save(draft({ id: 'd', kind: 'draft', section: 'query' }));

      expect(store.scratchFor('query').map((entry) => entry.id)).toEqual(['b', 'a']);
    });

    it('finds the open draft for a saved entity — this is the sidebar dot', () => {
      const store = useCallableDrafts();
      store.save(draft({ id: 'urn:ui-temp:edit', kind: 'draft', basedOn: 'urn:query:live' }));

      expect(store.draftFor('urn:query:live')?.id).toBe('urn:ui-temp:edit');
      expect(store.draftFor('urn:query:other')).toBeNull();
    });

    it('does not mistake a scratch item for a draft of something', () => {
      const store = useCallableDrafts();
      // A scratch record has no basedOn at all, so nothing can claim it.
      store.save(draft({ kind: 'scratch', basedOn: null }));
      expect(store.draftFor('urn:query:live')).toBeNull();
    });
  });
});

describe('useCallableDrafts — sections that are not queries', () => {
  beforeEach(() => {
    localStorage.clear();
    useCallableDrafts().clear();
  });

  /*
   * The regression this file did not have. `isDraftSection` was a hand-written
   * disjunction that omitted 'tupleSet', so a scratch tuple set read back after
   * a reload fell through to the 'query' default and had its rows replaced by
   * `queryString ?? null` — the work was gone and nothing said so.
   */
  it.each(['tupleSet', 'dataGraph', 'argumentSet'] as const)(
    'keeps section and body across a reload for %s',
    (section) => {
      const store = useCallableDrafts();
      store.save(draft({
        id: `urn:ui-temp:${section}-record`,
        section,
        kind: 'scratch',
        queryString: null,
        body: { marker: section },
      }));

      const reloaded = useCallableDrafts();
      reloaded.reload();
      const record = reloaded.get(`urn:ui-temp:${section}-record`);
      expect(record?.section).toBe(section);
      expect(record?.body).toEqual({ marker: section });
      expect(reloaded.scratchFor(section)).toHaveLength(1);
    },
  );
});

describe('useCallableDrafts — legacy argument-set migration', () => {
  const LEGACY_KEY = 'sparql-query-lib-argument-set-drafts';

  beforeEach(() => {
    localStorage.clear();
    useCallableDrafts().clear();
  });

  it('folds the old store in once and removes its key', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([{
      id: 'urn:ui-temp:argument-set:abc',
      kind: 'scratch',
      scope: 'queryGroup',
      targetId: 'urn:sqlib:query-group:1',
      name: 'Perth 2024',
      description: null,
      basedOn: null,
      basedOnVersion: null,
      tupleBindings: [{ tupleSignature: 'city', variables: ['city'], rows: [] }],
      scalarBindings: [{ parameterKind: 'limit', parameterName: 'pageSize', numericValue: 20 }],
      edits: 3,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    }]));

    const store = useCallableDrafts();
    store.reload();

    const record = store.get('urn:ui-temp:argument-set:abc');
    expect(record?.section).toBe('argumentSet');
    expect(record?.name).toBe('Perth 2024');
    expect(record?.edits).toBe(3);
    const body = record?.body as { scope: string; targetId: string; scalarBindings: unknown[] };
    expect(body.scope).toBe('queryGroup');
    expect(body.targetId).toBe('urn:sqlib:query-group:1');
    expect(body.scalarBindings).toHaveLength(1);

    // The old key is gone, so the migration cannot run twice and duplicate.
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    store.reload();
    expect(store.allDrafts.value.filter((d) => d.section === 'argumentSet')).toHaveLength(1);
  });

  it('survives a legacy payload it cannot read', () => {
    localStorage.setItem(LEGACY_KEY, '{ not json');
    const store = useCallableDrafts();
    expect(() => store.reload()).not.toThrow();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});
