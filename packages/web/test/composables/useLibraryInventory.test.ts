/**
 * What the landing screen counts, and what it says changed.
 *
 * Three claims are worth pinning, because each of them is a decision rather
 * than a mechanism: a count is scoped the way its section is scoped (so a
 * query in another library is not in this library's total), a section this
 * deployment has switched off is not asked for at all (the client throws on a
 * call into a disabled area, so asking would be a console error on the screen
 * the app opens on), and the activity log's verb is read off the two dates the
 * server stamps rather than from any change history, because there is none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, ref } from 'vue';

const entitiesOfKind = vi.fn();
const loadKind = vi.fn();
const loadBackends = vi.fn();
const backends = ref<Array<{ id: string }>>([]);
const flags = ref<Record<string, boolean>>({});

vi.mock('@/composables/useEntityKinds', async () => {
  const actual = await vi.importActual<typeof import('@/composables/useEntityKinds')>(
    '@/composables/useEntityKinds',
  );
  return {
    ...actual,
    useEntityKinds: () => ({ entitiesOfKind, loadKind }),
  };
});

vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({ backends, loadBackends }),
}));

vi.mock('@/composables/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ isEnabled: (key: string) => flags.value[key] ?? true }),
}));

import { useLibraryInventory } from '@/composables/useLibraryInventory';

const LIBRARY = 'urn:sqlib:library:one';
const OTHER = 'urn:sqlib:library:two';

const CREATED = '2026-01-01T00:00:00Z';

function entity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'urn:sqlib:query:a',
    name: 'A query',
    isPartOf: [LIBRARY],
    dateCreated: CREATED,
    dateModified: CREATED,
    currentVersionNumber: 1,
    ...overrides,
  };
}

/** Every kind answers empty unless the test says otherwise. */
function kinds(byKind: Record<string, unknown[]>) {
  entitiesOfKind.mockImplementation((kind: string) => byKind[kind] ?? []);
}

async function inventory(libraryId: string | null = LIBRARY) {
  const scope = effectScope();
  const id = ref<string | null>(libraryId);
  const result = scope.run(() => useLibraryInventory(id))!;
  await result.load();
  return { ...result, scope, id };
}

beforeEach(() => {
  entitiesOfKind.mockReset();
  loadKind.mockReset();
  loadBackends.mockReset();
  loadKind.mockResolvedValue(undefined);
  loadBackends.mockResolvedValue(undefined);
  backends.value = [];
  flags.value = {};
  kinds({});
});

describe('useLibraryInventory', () => {
  it('counts a library-scoped section by the library, not by the deployment', async () => {
    kinds({
      query: [
        entity({ id: 'urn:sqlib:query:a' }),
        entity({ id: 'urn:sqlib:query:b' }),
        entity({ id: 'urn:sqlib:query:elsewhere', isPartOf: [OTHER] }),
      ],
    });

    const { counts, totalItems } = await inventory();

    expect(counts.value.queries).toBe(2);
    expect(totalItems.value).toBe(2);
  });

  it('counts backends account-wide, and leaves them out of the library total', async () => {
    backends.value = [{ id: 'urn:sqlib:backend:a' }, { id: 'urn:sqlib:backend:b' }];
    kinds({ query: [entity()] });

    const { counts, totalItems } = await inventory();

    expect(counts.value.backends).toBe(2);
    expect(totalItems.value).toBe(1);
  });

  /*
   * Bench is the section with no `isPartOf` at all — experiments are
   * account-level — so it is the one that must not be filtered away when a
   * library is active.
   */
  it('counts an unscoped section whatever library is active', async () => {
    kinds({ benchmark: [{ id: 'urn:sqlib:benchmark:a', name: 'Throughput' }] });

    const { counts } = await inventory();

    expect(counts.value.benchmarks).toBe(1);
  });

  it('does not ask for a section this deployment has switched off', async () => {
    flags.value = { tests: false };

    const { counts } = await inventory();

    expect(loadKind.mock.calls.map(([kind]) => kind)).not.toContain('test');
    expect(counts.value.tests).toBeUndefined();
  });

  it('reads created and updated off the two dates, newest first', async () => {
    kinds({
      query: [
        entity({ id: 'urn:sqlib:query:new', name: 'Just made', dateModified: CREATED }),
        entity({
          id: 'urn:sqlib:query:edited',
          name: 'Edited since',
          dateModified: '2026-02-01T00:00:00Z',
          currentVersionNumber: 3,
        }),
      ],
    });

    const { activity } = await inventory();

    expect(activity.value.map((entry) => [entry.name, entry.verb, entry.version])).toEqual([
      ['Edited since', 'updated', 3],
      ['Just made', 'created', 1],
    ]);
    expect(activity.value[0].section).toBe('queries');
  });

  it('holds the log to the most recent handful', async () => {
    kinds({
      query: Array.from({ length: 12 }, (_, index) =>
        entity({
          id: `urn:sqlib:query:${index}`,
          name: `Query ${index}`,
          dateModified: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
        }),
      ),
    });

    const { activity } = await inventory();

    expect(activity.value).toHaveLength(8);
    expect(activity.value[0].name).toBe('Query 11');
  });

  it('draws nothing from a library that is not chosen yet', async () => {
    kinds({ query: [entity()] });

    const { counts, activity, totalItems } = await inventory(null);

    expect(counts.value.queries).toBe(0);
    expect(totalItems.value).toBe(0);
    expect(activity.value).toEqual([]);
  });

  /* A kind the server refuses must not take the rest of the screen with it. */
  it('survives a section that fails to load', async () => {
    loadKind.mockImplementation((kind: string) =>
      kind === 'test' ? Promise.reject(new Error('nope')) : Promise.resolve(undefined),
    );
    kinds({ query: [entity()] });

    const { counts } = await inventory();

    expect(counts.value.queries).toBe(1);
    expect(counts.value.tests).toBe(0);
  });
});
