/**
 * The library's tags: the vocabulary, not the assignments.
 *
 * A tag is library-scoped by construction, so this store holds one library's
 * worth at a time and reloads when the strip switches. Holding every library's tags at once would be cheap enough,
 * but it would make "is this name taken" and "which colour is free" both need a
 * library argument at every call site, and both questions are only ever asked
 * about the library on screen.
 *
 * What is *not* here: which entity carries which tag. That lives on the entity,
 * arrives with its list request, and is written through the entity's own PUT —
 * see `useEntityTags`.
 */
import { computed, reactive } from 'vue';
import type { Tag } from '@sparql-query-lib/contracts';
import { useApiClient } from './useApiClient';
import { nextFreeTagColor, normalizeTagColor } from '../lib/tagPalette';

type TagsState = {
  tags: Tag[];
  /** The library `tags` was loaded for; null before the first load. */
  loadedLibrary: string | null;
  loading: boolean;
  error: string | null;
  concurrency: Record<string, string | null>;
};

const state = reactive<TagsState>({
  tags: [],
  loadedLibrary: null,
  loading: false,
  error: null,
  concurrency: {},
});

/** Names fold for comparison the way the server folds them, and only for that. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function byName(a: Tag, b: Tag): number {
  return a.name.localeCompare(b.name);
}

export function useTagsStore() {
  const apiClient = useApiClient();

  const tags = computed(() => state.tags);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  /** `id → tag`, which is what a row of dots needs and a list scan does not. */
  const tagsById = computed(() => new Map(state.tags.map((tag) => [tag.id, tag])));

  async function loadTags(libraryId: string | null): Promise<Tag[]> {
    if (!libraryId) {
      state.tags = [];
      state.loadedLibrary = null;
      return [];
    }
    state.loading = true;
    state.error = null;
    try {
      const loaded = await apiClient.listTags(libraryId);
      state.tags = [...loaded].sort(byName);
      state.loadedLibrary = libraryId;
      return state.tags;
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : 'Failed to load tags';
      state.tags = [];
      state.loadedLibrary = null;
      return [];
    } finally {
      state.loading = false;
    }
  }

  /** Load once per library; the sidebar calls this on every render path. */
  async function ensureLoaded(libraryId: string | null): Promise<void> {
    if (!libraryId || state.loadedLibrary === libraryId || state.loading) return;
    await loadTags(libraryId);
  }

  function findByName(name: string): Tag | null {
    const key = nameKey(name);
    return state.tags.find((tag) => nameKey(tag.name) === key) ?? null;
  }

  /**
   * The colour a tag created right now would get.
   *
   * Read by the picker's create row, which shows the swatch before the tag
   * exists — the promise being that pressing Enter gives you that colour.
   */
  const nextColor = computed(() => nextFreeTagColor(state.tags.map((tag) => tag.color)));

  async function createTag(input: { name: string; libraryId: string; color?: string | null; description?: string | null }): Promise<Tag> {
    const created = await apiClient.createTag({
      name: input.name.trim(),
      color: normalizeTagColor(input.color ?? nextColor.value),
      description: input.description ?? null,
      isPartOf: input.libraryId,
    });
    const tag = created.data;
    state.concurrency[tag.id] = created.etag ?? tag.dateModified ?? null;
    state.tags = [...state.tags.filter((existing) => existing.id !== tag.id), tag].sort(byName);
    state.loadedLibrary = input.libraryId;
    return tag;
  }

  async function updateTag(id: string, input: { name?: string; color?: string | null; description?: string | null }): Promise<Tag> {
    const { data, etag } = await apiClient.updateTag(id, input, { ifMatch: state.concurrency[id] ?? null });
    state.concurrency[id] = etag ?? data.dateModified ?? null;
    state.tags = state.tags.map((tag) => (tag.id === id ? data : tag)).sort(byName);
    return data;
  }

  /**
   * Delete unlabels: the server strips the tag from everything carrying it and
   * the entity survives. Callers still reload their own lists afterwards —
   * their copies of those entities are what went stale, not this one.
   */
  async function deleteTag(id: string): Promise<void> {
    await apiClient.deleteTag(id);
    state.tags = state.tags.filter((tag) => tag.id !== id);
    delete state.concurrency[id];
  }

  return {
    tags,
    tagsById,
    loading,
    error,
    nextColor,
    loadTags,
    ensureLoaded,
    findByName,
    createTag,
    updateTag,
    deleteTag,
  };
}
