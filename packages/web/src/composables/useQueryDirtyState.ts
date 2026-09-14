import { ref, watch, readonly } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import type { Ref } from 'vue';

export interface UseQueryDirtyStateDeps {
  queryCode: Ref<string>;
  currentVersion: Ref<string | null>;
  selectedVersion: Ref<string | null>;
  loadedQueryString: Ref<string | null>;
}

/**
 * Tracks whether the current query code differs from the last saved version.
 * Uses debounced comparison to avoid flickering during typing.
 * Resets dirty state when version changes or after successful save.
 */
export function useQueryDirtyState(deps: UseQueryDirtyStateDeps) {
  const isDirty = ref(false);
  const lastSavedQueryString = ref<string | null>(null);

  // Debounced dirty check (500ms after typing stops)
  const checkDirtyState = useDebounceFn(() => {
    if (!deps.currentVersion.value) {
      // New query - not dirty since there's no saved version
      isDirty.value = false;
      return;
    }

    const currentCode = deps.queryCode.value.trim();
    const savedCode = lastSavedQueryString.value?.trim() ?? '';

    isDirty.value = currentCode !== savedCode;
  }, 500);

  // Watch for code changes
  watch(
    () => deps.queryCode.value,
    () => {
      checkDirtyState();
    }
  );

  // CRITICAL: Watch selectedVersion to detect version switching
  watch(
    () => deps.selectedVersion.value,
    () => {
      // When version changes, update saved query string and reset dirty
      lastSavedQueryString.value = deps.loadedQueryString.value;
      isDirty.value = false;
    }
  );

  // Also watch currentVersion for new saves
  watch(
    () => deps.currentVersion.value,
    () => {
      lastSavedQueryString.value = deps.loadedQueryString.value;
      isDirty.value = false;
    }
  );

  // Keep saved query string in sync with the most recently loaded version content
  watch(
    () => deps.loadedQueryString.value,
    (latest) => {
      lastSavedQueryString.value = latest;
      isDirty.value = false;
    }
  );

  // Reset dirty state after save
  const resetDirtyState = () => {
    lastSavedQueryString.value = deps.queryCode.value.trim();
    isDirty.value = false;
  };

  return {
    isDirty: readonly(isDirty),
    resetDirtyState,
  };
}
