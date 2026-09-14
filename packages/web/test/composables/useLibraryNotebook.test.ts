/**
 * The library page's data layer.
 *
 * The point of these is that the tab and the exported file are one document:
 * the tab reads the same route the export writes from, loads it with the same
 * `fromBundle`, and previews with the same `text()`. So what is worth pinning
 * is that nothing here reshapes the bundle on the way through, and that a
 * payload the runtime refuses surfaces the runtime's own words rather than a
 * reworded approximation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

const getLibraryExportBundle = vi.fn();

vi.mock('@/composables/useApiClient', () => ({
  useApiClient: () => ({ getLibraryExportBundle }),
}));

import { useLibraryNotebook } from '@/composables/useLibraryNotebook';

const TEXT = 'SELECT ?name WHERE { VALUES ?city { UNDEF } ?p :livesIn ?city ; :name ?name }';
const SLOT_START = TEXT.indexOf('VALUES');
const SLOT_END = TEXT.indexOf('}', SLOT_START) + 1;

function payload() {
  return {
    bundle: {
      version: 1 as const,
      library: { id: 'urn:lib', name: 'Test library' },
      queries: {
        people: {
          template: {
            text: TEXT,
            slots: [{ start: SLOT_START, end: SLOT_END, vars: ['city'] }],
            prefixes: [],
          },
          queryType: 'SELECT' as const,
          limitParameters: [],
          offsetParameters: [],
          inferredInputs: [['city']],
          textHash: 'sha256-unchecked',
          tags: ['urn:tag:people'],
          description: 'Everyone in a city.',
        },
      },
    },
    skipped: [{ id: 'urn:q:draft', name: 'Draft', reason: 'The query has no current version.' }],
  };
}

/** Run a composable inside a scope so its watchers are disposed with the test. */
async function load(id: string | null = 'urn:lib') {
  const scope = effectScope();
  const libraryId = ref<string | null>(id);
  const notebook = scope.run(() => useLibraryNotebook(libraryId))!;
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
  return { notebook, libraryId, scope };
}

beforeEach(() => {
  getLibraryExportBundle.mockReset();
  getLibraryExportBundle.mockResolvedValue(payload());
});

describe('useLibraryNotebook', () => {
  it('asks the export route for every example, so the tab shows what the file would', async () => {
    await load();
    expect(getLibraryExportBundle).toHaveBeenCalledWith('urn:lib', { examples: 'all' });
  });

  it('exposes the bundle unchanged, in name order, with its skipped queries', async () => {
    const { notebook } = await load();
    expect(notebook.queries.value.map((entry) => entry.slug)).toEqual(['people']);
    expect(notebook.queries.value[0].query.description).toBe('Everyone in a city.');
    expect(notebook.skipped.value[0].reason).toBe('The query has no current version.');
    expect(notebook.error.value).toBeNull();
  });

  it('collects every tag any query carries, for the filter bar', async () => {
    const { notebook } = await load();
    expect(notebook.tags.value).toEqual(['urn:tag:people']);
  });

  it('substitutes in the browser, with the same runtime the export ships', async () => {
    const { notebook } = await load();
    const { text, error } = notebook.preview('people', {
      arguments: [
        {
          head: { vars: ['city'] },
          arguments: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }] },
        },
      ],
    });
    expect(error).toBeNull();
    expect(text).toContain('VALUES ?city { <http://example.org/Perth> }');
  });

  it('returns the runtime\'s own message for a payload that does not fit', async () => {
    const { notebook } = await load();
    const { text, error } = notebook.preview('people', { arguments: [] });
    expect(text).toBeNull();
    expect(error).toBeTruthy();
  });

  it('reports a failed load rather than rendering an empty library', async () => {
    getLibraryExportBundle.mockRejectedValue(new Error('Not Found'));
    const { notebook } = await load();
    expect(notebook.error.value).toBe('Not Found');
    expect(notebook.queries.value).toEqual([]);
  });

  it('does not call the API with no library selected', async () => {
    await load(null);
    expect(getLibraryExportBundle).not.toHaveBeenCalled();
  });
});
