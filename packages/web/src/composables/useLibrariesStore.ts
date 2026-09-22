import { computed, reactive } from 'vue';
import {
  type Library,
  type LibraryCreateInput,
} from '@sparql-query-lib/contracts';
import type { LibraryFormInput } from '../types/library.js';
import { useApiClient } from './useApiClient.js';
import { useSettings } from './useSettings.js';
import { useDeploymentMode } from './useDeploymentMode.js';
import { SYSTEM_LIBRARY_ID } from '../lib/constants.js';

type LibraryState = {
  items: Library[];
  loading: boolean;
  error: string | null;
  concurrency: Record<string, string | null>;
};

const state = reactive<LibraryState>({
  items: [],
  loading: false,
  error: null,
  concurrency: {},
});

function deriveIfMatchToken(etag: string | null, entity: Library | null): string | null {
  if (etag && typeof etag === 'string' && etag.trim().length > 0) {
    return etag;
  }
  if (!entity) {
    return null;
  }
  return entity.dateModified ?? entity.dateCreated ?? null;
}

function normalizeInput(input: LibraryFormInput): LibraryCreateInput {
  const toNullable = (value: string | null | undefined) => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    name: input.name.trim(),
    description: toNullable(input.description),
    defaultBackend: toNullable(input.defaultBackend),
  };
}

function toFormInput(library: Library): LibraryFormInput {
  return {
    id: library.id,
    name: library.name,
    description: library.description ?? null,
    defaultBackend: library.defaultBackend ?? null,
  };
}

export function useLibrariesStore() {
  const {
    listLibraries,
    getLibrary,
    createLibrary,
    updateLibrary,
    deleteLibrary,
  } = useApiClient();

  const libraries = computed(() => state.items);

  /**
   * The libraries the UI is allowed to show.
   *
   * The System Library is an implementation detail of the app itself, so it is
   * only on screen when Hofstadter mode says the app may look at itself. Every
   * list, picker and dialog reads this rather than `libraries`, otherwise the
   * setting hides it from one surface and leaves it selectable — and therefore
   * writable — from the next.
   *
   * A read-only deployment answers no whatever the setting says. The stored
   * preference survives — it is per browser, and flipping deployments must not
   * rewrite it — so the check is here as well as on the toggle, which would
   * otherwise read off while the library it names stayed in every picker.
   */
  const { settings } = useSettings();
  const { isReadOnly } = useDeploymentMode();
  const visibleLibraries = computed(() =>
    settings.value.hofstadterMode && !isReadOnly.value
      ? state.items
      : state.items.filter((library) => library.id !== SYSTEM_LIBRARY_ID),
  );

  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  const loadLibraries = async () => {
    state.loading = true;
    state.error = null;
    try {
      state.items = await listLibraries();
    } catch (err: any) {
      state.error = err?.message ?? 'Failed to load libraries';
      state.items = [];
    } finally {
      state.loading = false;
    }
  };

  const fetchLibrary = async (id: string) => {
    const result = await getLibrary(id);
    state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
    return {
      library: result.data,
      ifMatch: state.concurrency[id],
      form: toFormInput(result.data),
    };
  };

  const create = async (input: LibraryFormInput) => {
    const payload = normalizeInput(input);
    const result = await createLibrary(payload);
    state.concurrency[result.data.id] = deriveIfMatchToken(result.etag, result.data);
    await loadLibraries();
    return result.data;
  };

  const update = async (id: string, input: LibraryFormInput, explicitIfMatch?: string | null) => {
    const payload = normalizeInput(input);
    const ifMatch = explicitIfMatch ?? state.concurrency[id] ?? null;
    const result = await updateLibrary(id, payload, { ifMatch });
    state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
    await loadLibraries();
    return result.data;
  };

  const remove = async (id: string) => {
    await deleteLibrary(id);
    delete state.concurrency[id];
    await loadLibraries();
  };

  return {
    libraries,
    visibleLibraries,
    loading,
    error,
    concurrency: state.concurrency,
    loadLibraries,
    createLibrary: create,
    updateLibrary: update,
    deleteLibrary: remove,
    fetchLibrary,
    toFormInput,
    normalizeInput,
  };
}
