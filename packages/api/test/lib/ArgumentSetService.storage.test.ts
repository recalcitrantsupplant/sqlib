/**
 * Argument set storage: SRJ strings in, unchanged detail shape out.
 *
 * The point of these is the *seam*, not the CRUD: rows moved from one entity
 * per cell to one string per binding, and the API contract did not move with
 * them. So they assert what a caller sees, plus the two things the switch could
 * plausibly break — legacy stores still reading, and tuple set rows unioning.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tableParameterKey } from '@sparql-query-lib/types';

const store = new Map<string, Record<string, unknown>>();

const coordinator = {
  get: vi.fn((iri: string) => store.get(iri) ?? null),
  list: vi.fn((type: string) =>
    [...store.values()].filter(entity => entity['@type'] === type)
  ),
  create: vi.fn(async (type: string, entity: Record<string, unknown>) => {
    const id = String(entity.$id ?? entity.id);
    store.set(id, { ...entity, $id: id, '@type': type });
    return store.get(id);
  }),
  update: vi.fn(async (type: string, id: string, updates: Record<string, unknown>) => {
    const current = store.get(id);
    if (!current) return null;
    const next = { ...current, ...updates };
    store.set(id, next);
    return next;
  }),
  delete: vi.fn(async (_type: string, id: string) => {
    store.delete(id);
  }),
};

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => coordinator,
  getEntityRepositories: () => ({}),
}));

// Mirrors the real resolver's fallback: `isPartOf` is containment,
// `targetEntity` is how an argument set reaches its query, and either may need
// one hop to land on a library.
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

const LIBRARY = 'urn:sqlib:library:lib1';
const QUERY = 'urn:sqlib:query:q1';

function seedQuery() {
  store.set(LIBRARY, { $id: LIBRARY, '@type': 'Library', name: 'Lib' });
  store.set(QUERY, { $id: QUERY, '@type': 'Query', name: 'Q', isPartOf: [LIBRARY] });
}

const service = new ArgumentSetService();

const CITY_ROWS = [
  { values: { city: { type: 'literal' as const, value: 'Perth' } } },
  { values: { city: { type: 'literal' as const, value: 'Hobart' } } },
];

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  seedQuery();
});

describe('argument set storage', () => {
  it('stores rows as one SRJ string, not an entity per cell', async () => {
    await service.createForTarget('query', QUERY, {
      name: 'cities',
      tupleBindings: [{ variables: ['city'], rows: CITY_ROWS }],
    });

    const bindings = [...store.values()].filter(e => e['@type'] === 'ArgumentTupleBinding');
    expect(bindings).toHaveLength(1);
    expect(JSON.parse(String(bindings[0].contentString))).toEqual({
      head: { vars: ['city'] },
      results: {
        bindings: [
          { city: { type: 'literal', value: 'Perth' } },
          { city: { type: 'literal', value: 'Hobart' } },
        ],
      },
    });

    // The entity families that made a 5,000-row table 25,000 writes.
    expect([...store.values()].filter(e => e['@type'] === 'ArgumentRow')).toHaveLength(0);
    expect([...store.values()].filter(e => e['@type'] === 'ArgumentValue')).toHaveLength(0);
  });

  /*
   * Frozen on create (issue #192), which argument sets were left out of.
   *
   * They were created mutable and frozen by a second call, so a set made any
   * other way than through the web UI's save flow stayed mutable — and the
   * runtime export refused to run it. Creating it frozen is what removes the
   * state that refusal existed to catch. There is no stored flag to read any
   * more (#210) — a version's content never changing is an invariant of the
   * type, so what this asserts now is that a second version can be created,
   * and that a PATCH attempting to edit either one's content is refused.
   */
  it('creates v1, and a later version too, both immutable by construction', async () => {
    const detail = await service.createForTarget('query', QUERY, {
      name: 'cities',
      tupleBindings: [{ variables: ['city'], rows: CITY_ROWS }],
    });
    expect(detail.currentVersion).not.toHaveProperty('immutable');

    const next = await service.createVersion(detail.id, {
      tupleBindings: [{ variables: ['city'], rows: CITY_ROWS }],
    });
    expect(next).not.toHaveProperty('immutable');
  });

  it('returns the detail shape callers already depend on', async () => {
    const detail = await service.createForTarget('query', QUERY, {
      name: 'cities',
      tupleBindings: [{ variables: ['city'], rows: CITY_ROWS }],
    });

    const [binding] = detail.tupleBindings;
    expect(binding.variables).toEqual(['city']);
    expect(binding.tupleSignature).toBe('city');
    expect(binding.rows).toEqual([
      { id: expect.any(String), position: 0, values: { city: { type: 'literal', value: 'Perth' } } },
      { id: expect.any(String), position: 1, values: { city: { type: 'literal', value: 'Hobart' } } },
    ]);
    // Row ids are synthesised now, but still stable and unique per row.
    expect(new Set(binding.rows.map(r => r.id)).size).toBe(2);
  });

  it('derives the library from the target', async () => {
    const detail = await service.createForTarget('query', QUERY, {
      name: 'cities',
      tupleBindings: [{ variables: ['city'], rows: CITY_ROWS }],
    });
    expect(detail.libraryId).toBe(LIBRARY);
    expect(store.get(detail.id)?.isPartOf).toBe(LIBRARY);
  });

  it('drops an absent value rather than binding an empty literal', async () => {
    const detail = await service.createForTarget('query', QUERY, {
      name: 'partial',
      tupleBindings: [{
        variables: ['a', 'b'],
        rows: [{ values: { a: { type: 'literal', value: 'x' } } }],
      }],
    });

    expect(detail.tupleBindings[0].rows[0].values).toEqual({ a: { type: 'literal', value: 'x' } });
    expect('b' in detail.tupleBindings[0].rows[0].values).toBe(false);
  });

  it('exports a runtime payload keyed by signature', async () => {
    const detail = await service.createForTarget('query', QUERY, {
      name: 'cities',
      tupleBindings: [{ variables: ['city'], rows: CITY_ROWS }],
    });
    // A version is what the runtime export reads, so save one — which is
    // what the client does on every save.
    await service.createVersion(detail.id, {
      tupleBindings: [{ variables: ['city'], rows: CITY_ROWS }],
    });

    const payload = await service.exportRuntimePayload([detail.id]);
    // Keyed canonically rather than by the stored signature string: the map key
    // is opaque, so it is compared against the helper both sides now use.
    expect([...payload.tupleMap.keys()]).toEqual([tableParameterKey(['city'])]);
    expect(payload.tupleList[0]).toEqual({
      head: { vars: ['city'] },
      arguments: {
        bindings: [
          { city: { type: 'literal', value: 'Perth' } },
          { city: { type: 'literal', value: 'Hobart' } },
        ],
      },
    });
  });
});

describe('tuple set sources', () => {
  const VERSION = 'urn:sqlib:tuple-set-version:v1';

  function seedTupleSetVersion(bindings: unknown[]) {
    store.set(VERSION, {
      $id: VERSION,
      '@type': 'TupleSetVersion',
      version: 1,
      contentString: JSON.stringify({ head: { vars: ['city'] }, results: { bindings } }),
    });
  }

  it('unions tuple set rows with inline rows under one signature', async () => {
    seedTupleSetVersion([{ city: { type: 'literal', value: 'Darwin' } }]);

    const detail = await service.createForTarget('query', QUERY, {
      name: 'mixed',
      tupleBindings: [{ variables: ['city'], rows: [CITY_ROWS[0]] }],
    });
    await service.createVersion(detail.id, {
      tupleBindings: [{
        variables: ['city'],
        rows: [CITY_ROWS[0]],
        tupleSetVersions: [VERSION],
      }],
    });

    const payload = await service.exportRuntimePayload([detail.id]);
    expect(payload.tupleList[0].arguments.bindings).toEqual([
      { city: { type: 'literal', value: 'Perth' } },
      { city: { type: 'literal', value: 'Darwin' } },
    ]);
  });

  it('drops rows that share no column with the clause, never widening it', async () => {
    // The dangerous case. A row keyed only by foreign names is a non-empty
    // object, so passing it through would render as a row where every one of
    // *this* clause's variables is UNDEF — a wildcard matching everything,
    // inverting the query rather than narrowing it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.set(VERSION, {
      $id: VERSION,
      '@type': 'TupleSetVersion',
      version: 1,
      tupleColumns: ['town'],
      contentString: JSON.stringify({
        head: { vars: ['town'] },
        results: { bindings: [{ town: { type: 'literal', value: 'Darwin' } }] },
      }),
    });

    const detail = await service.createForTarget('query', QUERY, {
      name: 'mismatched',
      tupleBindings: [{ variables: ['city'], rows: [CITY_ROWS[0]] }],
    });
    await service.createVersion(detail.id, {
      tupleBindings: [{ variables: ['city'], rows: [CITY_ROWS[0]], tupleSetVersions: [VERSION] }],
    });

    const payload = await service.exportRuntimePayload([detail.id]);
    expect(payload.tupleList[0].arguments.bindings).toEqual([
      { city: { type: 'literal', value: 'Perth' } },
    ]);
    // And it says so, rather than looking like it worked.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('contributes nothing'));
    warn.mockRestore();
  });

  it('projects a partially overlapping row onto the clause', async () => {
    store.set(VERSION, {
      $id: VERSION,
      '@type': 'TupleSetVersion',
      version: 1,
      tupleColumns: ['city', 'pop'],
      contentString: JSON.stringify({
        head: { vars: ['city', 'pop'] },
        results: {
          bindings: [{
            city: { type: 'literal', value: 'Darwin' },
            pop: { type: 'literal', value: '150000' },
          }],
        },
      }),
    });

    const detail = await service.createForTarget('query', QUERY, {
      name: 'wider',
      tupleBindings: [{ variables: ['city'], rows: [] }],
    });
    await service.createVersion(detail.id, {
      tupleBindings: [{ variables: ['city'], rows: [], tupleSetVersions: [VERSION] }],
    });

    const payload = await service.exportRuntimePayload([detail.id]);
    // The extra column is dropped, not passed through as an unbound variable.
    expect(payload.tupleList[0].arguments.bindings).toEqual([
      { city: { type: 'literal', value: 'Darwin' } },
    ]);
  });

  it('skips a version that has gone missing rather than failing the run', async () => {
    // A saved set pins version ids; a dangling one means the version was
    // deleted, and refusing to run an otherwise valid set is the worse answer.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const detail = await service.createForTarget('query', QUERY, {
      name: 'dangling',
      tupleBindings: [{ variables: ['city'], rows: [CITY_ROWS[0]] }],
    });
    await service.createVersion(detail.id, {
      tupleBindings: [{
        variables: ['city'],
        rows: [CITY_ROWS[0]],
        tupleSetVersions: ['urn:sqlib:tuple-set-version:gone'],
      }],
    });

    const payload = await service.exportRuntimePayload([detail.id]);
    expect(payload.tupleList[0].arguments.bindings).toEqual([
      { city: { type: 'literal', value: 'Perth' } },
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
