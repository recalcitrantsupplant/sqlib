/**
 * The environment the workspace runs in, beside the active library.
 *
 * A library may define environments (dev, prod). Picking one makes every run
 * of a query or group by its id run the version that environment points to.
 * `latest` (no pick) runs the current version, as before environments existed.
 * The pick is kept per library, since environment names belong to a library.
 * See docs/explanation/environments.md.
 */
import { computed, ref, watch } from 'vue';
import type { Environment } from '@sparql-query-lib/contracts';
import { useActiveLibrary } from './useActiveLibrary';
import { useApiClient } from './useApiClient';

export const LATEST_ENVIRONMENT = 'latest';
const STORAGE_KEY = 'sparql-query-lib-active-environment';

function readStored(): Record<string, string> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// Module-level: the switcher, every run and every list read one selection.
const picks = ref<Record<string, string>>(readStored());
const environments = ref<Environment[]>([]);
const loadedFor = ref<string | null>(null);
const libraryId = ref<string | null>(null);
let watching = false;

/**
 * The environment name to send with a run, or null for `latest`. A pick the
 * library no longer defines counts as `latest`, so a deleted environment
 * never makes every run fail.
 */
export function selectedEnvironmentName(): string | null {
  const library = libraryId.value;
  if (!library) return null;
  const name = picks.value[library];
  if (!name || name === LATEST_ENVIRONMENT) return null;
  if (loadedFor.value === library && !environments.value.some((env) => env.name === name)) return null;
  return name;
}

export function useActiveEnvironment() {
  const { activeLibraryId } = useActiveLibrary();
  const api = useApiClient();

  async function load(library: string | null) {
    libraryId.value = library;
    if (!library) {
      environments.value = [];
      loadedFor.value = null;
      return;
    }
    try {
      const list = await api.listEnvironments(library);
      if (libraryId.value !== library) return;
      environments.value = list;
      loadedFor.value = library;
    } catch {
      // A server without environments, or a caller who cannot list them:
      // the switcher offers nothing and every run is `latest`.
      environments.value = [];
      loadedFor.value = library;
    }
  }

  if (!watching) {
    watching = true;
    watch(activeLibraryId, (id) => void load(id), { immediate: true });
    watch(picks, (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // Storage can be unavailable; the pick then lasts for the session.
      }
    }, { deep: true });
  }

  const activeEnvironmentName = computed(() => {
    // Read the refs the getter reads, so this recomputes with them.
    void picks.value; void environments.value; void libraryId.value;
    return selectedEnvironmentName() ?? LATEST_ENVIRONMENT;
  });

  const activeEnvironment = computed(
    () => environments.value.find((env) => env.name === activeEnvironmentName.value) ?? null,
  );

  function setActiveEnvironment(name: string) {
    const library = libraryId.value;
    if (!library) return;
    picks.value = { ...picks.value, [library]: name };
  }

  return {
    environments: computed(() => environments.value),
    activeEnvironmentName,
    activeEnvironment,
    setActiveEnvironment,
    reload: () => load(libraryId.value),
  };
}

/**
 * The environments that point at each version, and the version the active
 * environment points at, for an editor that lists one entity's versions.
 *
 * Read from the environments the switcher already loaded: each environment
 * lists the version ids it points to, so no extra request is needed.
 */
export function useEnvironmentVersions(versionIds: () => readonly string[]) {
  const { environments, activeEnvironment, activeEnvironmentName } = useActiveEnvironment();

  /** Version id to the names of the environments that point at it, in chain order. */
  const environmentsByVersion = computed(() => {
    const ids = new Set(versionIds());
    const result: Record<string, string[]> = {};
    for (const env of environments.value) {
      for (const version of env.versions ?? []) {
        if (!ids.has(version)) continue;
        (result[version] ??= []).push(env.name);
      }
    }
    return result;
  });

  /**
   * The version the active environment points at, or null: null for
   * `latest`, and null when this entity is not in the active environment.
   */
  const activeEnvironmentVersion = computed(() => {
    const env = activeEnvironment.value;
    if (!env) return null;
    const ids = new Set(versionIds());
    return (env.versions ?? []).find((version) => ids.has(version)) ?? null;
  });

  return { environmentsByVersion, activeEnvironment, activeEnvironmentVersion, activeEnvironmentName };
}
