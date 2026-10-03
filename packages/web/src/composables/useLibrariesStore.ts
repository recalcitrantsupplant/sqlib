import { computed } from 'vue';
import {
  type Library,
  type LibraryCreateInput,
} from '@sparql-query-lib/contracts';
import type { LibraryFormInput } from '../types/library.js';
import { useApiClient } from './useApiClient.js';
import { useSettings } from './useSettings.js';
import { useDeploymentMode } from './useDeploymentMode.js';
import { SYSTEM_LIBRARY_ID } from '../lib/constants.js';
import { createVersionedEntityStore } from './createVersionedEntityStore';

const useLibraryEntities = createVersionedEntityStore<Library, LibraryFormInput, LibraryFormInput>({
  noun: 'library',
  nounPlural: 'libraries',
  api: () => {
    const client = useApiClient();
    return {
      list: client.listLibraries,
      get: client.getLibrary,
      // Normalised on the way out, so the form's empty strings are sent as nulls.
      create: (input) => client.createLibrary(normalizeInput(input)),
      update: (id, input, options) => client.updateLibrary(id, normalizeInput(input), options),
      remove: client.deleteLibrary,
    };
  },
});

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
  const entities = useLibraryEntities();
  const libraries = entities.items;

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
      ? entities.items.value
      : entities.items.value.filter((library) => library.id !== SYSTEM_LIBRARY_ID),
  );

  const fetchLibrary = async (id: string) => {
    const { data, ifMatch } = await entities.fetch(id);
    return { library: data, ifMatch, form: toFormInput(data) };
  };

  return {
    libraries,
    visibleLibraries,
    loading: entities.loading,
    error: entities.error,
    concurrency: entities.concurrency,
    loadLibraries: entities.load,
    createLibrary: entities.create,
    updateLibrary: entities.update,
    deleteLibrary: entities.remove,
    fetchLibrary,
    toFormInput,
    normalizeInput,
  };
}
