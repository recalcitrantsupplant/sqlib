/**
 * A rule set's SRL document, at one version, for display.
 *
 * Cached for the page's life by rule set and version: a version's document
 * does not change, and a floating cell (no version) reads the current one,
 * which changes only when someone saves a new version elsewhere.
 */
import { ref, watch, type Ref } from 'vue';
import { useApiClient } from './useApiClient';

const cache = new Map<string, Promise<string | null>>();

export function useRuleSetSrl(ruleSetId: Ref<string | null>, version: Ref<number | null>) {
  const apiClient = useApiClient();
  const srl = ref<string | null>(null);

  watch(
    [ruleSetId, version],
    async ([id, at]) => {
      srl.value = null;
      if (!id) return;
      const key = `${id}|${at ?? ''}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = apiClient
          .exportRuleSetSrl(id, { version: at })
          .then((exported) => exported?.srl ?? null)
          .catch((cause: unknown) => {
            // The cell still runs without its text; it just cannot show it.
            console.warn('[useRuleSetSrl] SRL unavailable', cause);
            cache.delete(key);
            return null;
          });
        cache.set(key, pending);
      }
      const text = await pending;
      if (ruleSetId.value === id && version.value === at) srl.value = text;
    },
    { immediate: true },
  );

  return { srl };
}
