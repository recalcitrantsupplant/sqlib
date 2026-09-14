import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import type { Query } from '@sparql-query-lib/contracts';

import { useQueryAssignmentOptions } from '@/composables/useQueryAssignmentOptions';

const LIBRARY = 'urn:sqlib:library:1';

const makeQuery = (overrides: Partial<Query> = {}): Query =>
  ({
    id: 'urn:sqlib:query:1',
    name: 'Cities',
    description: null,
    isPartOf: [LIBRARY],
    currentVersion: 'urn:sqlib:query-version:1-2',
    ...overrides,
  }) as Query;

function harness(queries: Query[], versions: Record<string, Array<{ id: string; version: number }>>) {
  const store = {
    queries: ref<Query[]>([]),
    loadQueries: vi.fn(async () => {
      store.queries.value = queries;
    }),
    loadQueryVersions: vi.fn(async (queryId: string) => versions[queryId] ?? []),
  };
  const libraryId = ref(LIBRARY);
  return { store, libraryId, options: useQueryAssignmentOptions(libraryId, store) };
}

describe('useQueryAssignmentOptions', () => {
  it('lists the library\'s queries, newest version first, and marks the current one', async () => {
    const { options } = harness([makeQuery()], {
      'urn:sqlib:query:1': [
        { id: 'urn:sqlib:query-version:1-1', version: 1 },
        { id: 'urn:sqlib:query-version:1-2', version: 2 },
      ],
    });

    await options.ensureLoaded();

    expect(options.options.value).toHaveLength(1);
    expect(options.options.value[0].versions.map((entry) => entry.version)).toEqual([2, 1]);
    expect(options.options.value[0].versions[0].isCurrent).toBe(true);
  });

  it('leaves out queries from other libraries', async () => {
    const { options } = harness(
      [makeQuery(), makeQuery({ id: 'urn:sqlib:query:2', name: 'Elsewhere', isPartOf: ['urn:sqlib:library:2'] })],
      {
        'urn:sqlib:query:1': [{ id: 'urn:sqlib:query-version:1-2', version: 2 }],
        'urn:sqlib:query:2': [{ id: 'urn:sqlib:query-version:2-1', version: 1 }],
      },
    );

    await options.ensureLoaded();

    expect(options.options.value.map((entry) => entry.name)).toEqual(['Cities']);
  });

  /**
   * The regression the dropdown replaced a dialog to fix: the dialog required
   * `currentVersion` to be set, so a query whose pointer was missing vanished
   * from the chooser even though every one of its versions was assignable.
   */
  it('still offers a query whose currentVersion pointer is unset', async () => {
    const { options } = harness([makeQuery({ currentVersion: null as unknown as string })], {
      'urn:sqlib:query:1': [{ id: 'urn:sqlib:query-version:1-1', version: 1 }],
    });

    await options.ensureLoaded();

    expect(options.options.value.map((entry) => entry.name)).toEqual(['Cities']);
    expect(options.options.value[0].versions[0].isCurrent).toBe(false);
  });

  it('drops a query that has no saved version to name', async () => {
    const { options } = harness([makeQuery()], { 'urn:sqlib:query:1': [] });

    await options.ensureLoaded();

    expect(options.options.value).toEqual([]);
  });

  it('loads once per library, and again when the library changes', async () => {
    const { options, store, libraryId } = harness([makeQuery()], {
      'urn:sqlib:query:1': [{ id: 'urn:sqlib:query-version:1-2', version: 2 }],
    });

    await options.ensureLoaded();
    await options.ensureLoaded();
    expect(store.loadQueries).toHaveBeenCalledTimes(1);

    libraryId.value = 'urn:sqlib:library:2';
    await Promise.resolve();
    await options.ensureLoaded();
    expect(store.loadQueries).toHaveBeenCalledTimes(2);
  });

  it('asks for nothing while there is no library to ask about', async () => {
    const { options, store, libraryId } = harness([makeQuery()], {});
    libraryId.value = '';

    await options.ensureLoaded();

    expect(store.loadQueries).not.toHaveBeenCalled();
    expect(options.options.value).toEqual([]);
  });

  it('reports a failed load rather than showing an empty library', async () => {
    const { options, store } = harness([], {});
    store.loadQueries.mockRejectedValueOnce(new Error('network down'));

    await options.ensureLoaded();

    expect(options.error.value).toBe('network down');
    expect(options.loading.value).toBe(false);
  });
});
