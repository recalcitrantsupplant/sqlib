/**
 * Graph parameters and standalone creation.
 *
 * A query group's start node *declares* graph ports, which makes a graph an
 * argument in the same sense a VALUES clause's rows are; a query declares no
 * such parameter (see `docs/concepts.md`). These cover what that adds to the
 * service: a fourth binding kind, a creation path with no callable to derive a
 * library from, and the parameter keys the completion check on `/execute`
 * reasons over.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { graphParameterKey, scalarParameterKey, tableParameterKey } from '@sparql-query-lib/types';

const store = new Map<string, Record<string, unknown>>();

const coordinator = {
  get: vi.fn((iri: string) => store.get(iri) ?? null),
  list: vi.fn((type: string) => [...store.values()].filter(entity => entity['@type'] === type)),
  create: vi.fn(async (type: string, entity: Record<string, unknown>) => {
    const id = String(entity.$id ?? entity.id);
    store.set(id, { ...entity, $id: id, '@type': type });
    return store.get(id);
  }),
  update: vi.fn(async (_type: string, id: string, updates: Record<string, unknown>) => {
    const current = store.get(id);
    if (!current) return null;
    const next = { ...current, ...updates };
    store.set(id, next);
    return next;
  }),
  delete: vi.fn(async (_type: string, id: string) => { store.delete(id); }),
};

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => coordinator,
  getEntityRepositories: () => ({}),
}));

vi.mock('../../src/auth/enforce.js', () => ({
  resolveOwningLibrary: function resolve(entity: unknown, depth = 0): string | null {
    if (!entity || typeof entity !== 'object' || depth > 4) return null;
    const record = entity as { '@type'?: unknown; $id?: unknown; isPartOf?: unknown; targetEntity?: unknown };
    if (record['@type'] === 'Library' && typeof record.$id === 'string') return record.$id;
    const raw = record.isPartOf ?? record.targetEntity;
    const parents = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const parent of parents) {
      if (store.get(String(parent))?.['@type'] === 'Library') return String(parent);
    }
    for (const parent of parents) {
      const resolved = resolve(store.get(String(parent)), depth + 1);
      if (resolved) return resolved;
    }
    return null;
  },
}));

const { ArgumentSetService } = await import('../../src/lib/ArgumentSetService.js');
const { DataGraphContentError } = await import('../../src/lib/dataGraphInput.js');

const LIBRARY = 'urn:sqlib:library:lib1';
const OTHER_LIBRARY = 'urn:sqlib:library:lib2';
const GROUP = 'urn:sqlib:query-group:g1';
const GRAPH_VERSION = 'urn:sqlib:data-graph-version:v1';
const TURTLE = '<http://ex/a> <http://ex/p> <http://ex/b> .';

const service = new ArgumentSetService();

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set(LIBRARY, { $id: LIBRARY, '@type': 'Library', name: 'Lib' });
  store.set(OTHER_LIBRARY, { $id: OTHER_LIBRARY, '@type': 'Library', name: 'Other' });
  store.set(GROUP, { $id: GROUP, '@type': 'QueryGroup', name: 'G', isPartOf: [LIBRARY] });
  store.set(GRAPH_VERSION, {
    $id: GRAPH_VERSION,
    '@type': 'DataGraphVersion',
    contentString: TURTLE,
    contentFormat: 'text/turtle',
    tripleCount: 1,
  });
});

describe('graph bindings', () => {
  it('round-trips a pinned version and reports the slot it fills', async () => {
    const detail = await service.createForTarget('queryGroup', GROUP, {
      name: 'with source',
      graphBindings: [{ dataGraphVersionId: GRAPH_VERSION }],
    });

    expect(detail.graphBindings).toHaveLength(1);
    expect(detail.graphBindings[0]).toMatchObject({ position: 0, dataGraphVersionId: GRAPH_VERSION });

    const payload = await service.exportRuntimePayload([detail.id]);
    expect(payload.dataGraphs).toEqual([
      { content: TURTLE, format: expect.any(String) },
    ]);
    expect(payload.filledParameters).toContain(graphParameterKey(0));
  });

  /*
   * The whole point of the split: a set says *what* it supplies and in what
   * order, and the group says which port each one reaches. Nothing on the
   * stored binding names a port.
   */
  it('keeps several graphs in the order they were given', async () => {
    const second = 'urn:sqlib:data-graph-version:v2';
    store.set(second, { $id: second, '@type': 'DataGraphVersion', contentString: '<http://ex/c> <http://ex/q> <http://ex/d> .', contentFormat: 'text/turtle', tripleCount: 1 });

    const detail = await service.createForTarget('queryGroup', GROUP, {
      name: 'two graphs',
      graphBindings: [{ dataGraphVersionId: GRAPH_VERSION }, { dataGraphVersionId: second }],
    });

    expect(detail.graphBindings.map(binding => binding.position)).toEqual([0, 1]);

    const payload = await service.exportRuntimePayload([detail.id]);
    expect(payload.dataGraphs.map(graph => graph.content)).toEqual([
      expect.stringContaining('http://ex/p'),
      expect.stringContaining('http://ex/q'),
    ]);
    expect([...payload.filledParameters].sort()).toEqual([
      graphParameterKey(0),
      graphParameterKey(1),
    ].sort());
  });

  it('round-trips pasted RDF, which a saved set stores as part of the call', async () => {
    const detail = await service.createForTarget('queryGroup', GROUP, {
      name: 'pasted',
      graphBindings: [{ contentString: TURTLE, contentFormat: 'text/turtle' }],
    });

    const payload = await service.exportRuntimePayload([detail.id]);
    expect(payload.dataGraphs[0].content).toContain('http://ex/p');
  });

  it('refuses a binding naming both a version and inline content', async () => {
    await expect(service.createForTarget('queryGroup', GROUP, {
      name: 'both',
      graphBindings: [{ dataGraphVersionId: GRAPH_VERSION, contentString: TURTLE }],
    })).rejects.toBeInstanceOf(DataGraphContentError);
  });

  it('refuses a binding naming neither', async () => {
    await expect(service.createForTarget('queryGroup', GROUP, {
      name: 'neither',
      graphBindings: [{}],
    })).rejects.toBeInstanceOf(DataGraphContentError);
  });

  /*
   * Checked at write, so a stored set cannot be a run that fails later. The
   * same reasoning `resolveDataGraphInput` applies to the execute body.
   */
  it('refuses an unknown version at save rather than at every run', async () => {
    await expect(service.createForTarget('queryGroup', GROUP, {
      name: 'ghost',
      graphBindings: [{ dataGraphVersionId: 'urn:sqlib:data-graph-version:missing' }],
    })).rejects.toBeInstanceOf(DataGraphContentError);
  });

  it('hands the run content and format only, leaving the group to route it', async () => {
    const detail = await service.createForTarget('queryGroup', GROUP, {
      name: 'positional',
      graphBindings: [{ dataGraphVersionId: GRAPH_VERSION }],
    });
    const payload = await service.exportRuntimePayload([detail.id]);
    expect(Object.keys(payload.dataGraphs[0]).sort()).toEqual(['content', 'format']);
    expect(payload.filledParameters).toContain(graphParameterKey(0));
  });
});

describe('parameter keys a set reports as filled', () => {
  it('covers all three kinds at once', async () => {
    const detail = await service.createForTarget('queryGroup', GROUP, {
      name: 'everything',
      tupleBindings: [{ variables: ['city'], rows: [] }],
      scalarBindings: [{ parameterKind: 'limit', parameterName: 'pageSize', numericValue: 20 }],
      graphBindings: [{ dataGraphVersionId: GRAPH_VERSION }],
    });

    const payload = await service.exportRuntimePayload([detail.id]);
    expect([...payload.filledParameters].sort()).toEqual([
      graphParameterKey(0),
      scalarParameterKey('limit', 'pageSize'),
      tableParameterKey(['city']),
    ].sort());
  });
});

describe('standalone creation', () => {
  it('creates a set that names its own library, with no provenance', async () => {
    const detail = await service.create({
      name: 'Composed',
      libraryId: LIBRARY,
      tupleBindings: [{ variables: ['city'], rows: [] }],
    });

    expect(detail.libraryId).toBe(LIBRARY);
    expect(detail.scope).toBeNull();
    expect(detail.targetId).toBeNull();
    expect(detail.currentVersionId).toBeTruthy();
  });

  /*
   * The parent list is what distinguishes the two creation paths: a set made on
   * a callable's screen is listed on that callable, and one composed on the
   * rail has no parent to append to.
   */
  it('does not touch any callable, unlike createForTarget', async () => {
    await service.create({ name: 'Composed', libraryId: LIBRARY });
    expect((store.get(GROUP) as { argumentSets?: string[] }).argumentSets).toBeUndefined();

    await service.createForTarget('queryGroup', GROUP, { name: 'Under the group' });
    expect((store.get(GROUP) as { argumentSets?: string[] }).argumentSets).toHaveLength(1);
  });

  it('keeps provenance when it is given and agrees with the library', async () => {
    const detail = await service.create({
      name: 'Composed with provenance',
      libraryId: LIBRARY,
      scope: 'queryGroup',
      targetId: GROUP,
    });
    expect(detail.scope).toBe('queryGroup');
    expect(detail.targetId).toBe(GROUP);
  });

  /*
   * `resolveOwningLibrary` follows `isPartOf` first, so a target in another
   * library would not move the set — it would just make the two fields disagree
   * about where it lives, silently.
   */
  it('refuses a target from a different library', async () => {
    store.set('urn:sqlib:query-group:g2', {
      $id: 'urn:sqlib:query-group:g2', '@type': 'QueryGroup', name: 'G2', isPartOf: [OTHER_LIBRARY],
    });
    await expect(service.create({
      name: 'Disagreeing',
      libraryId: LIBRARY,
      targetId: 'urn:sqlib:query-group:g2',
    })).rejects.toThrow(/library/i);
  });

  it('refuses an unknown library', async () => {
    await expect(service.create({ name: 'Nowhere', libraryId: 'urn:sqlib:library:missing' }))
      .rejects.toThrow(/not found/i);
  });

  /* A set may fill only numbers, or only graph ports — see plan D4. */
  it('accepts a version with no table bindings at all', async () => {
    const detail = await service.create({
      name: 'Numbers only',
      libraryId: LIBRARY,
      scalarBindings: [{ parameterKind: 'limit', parameterName: 'pageSize', numericValue: 10 }],
    });
    expect(detail.tupleBindings).toEqual([]);
    expect(detail.scalarBindings).toHaveLength(1);
  });

  it('deletes cleanly with no callable to unlist it from', async () => {
    const detail = await service.create({
      name: 'Composed',
      libraryId: LIBRARY,
      graphBindings: [{ dataGraphVersionId: GRAPH_VERSION }],
    });
    await expect(service.delete(detail.id)).resolves.toBeUndefined();
    expect(store.get(detail.id)).toBeUndefined();
    expect([...store.values()].filter(e => e['@type'] === 'ArgumentGraphBinding')).toHaveLength(0);
  });
});
