/**
 * Whether this deployment keeps anything, read from the server.
 *
 * `SQLIB_READ_ONLY=true` makes the API refuse every write to its own state
 * (the API's `config/readOnly.ts`), which the SPA has to know before it offers
 * a button rather than after the 405 comes back. `/health` reports it beside
 * the auth mode for the same reason that one is reported: a client that
 * feature-detects works unchanged on both sides of the flip.
 *
 * The default is "not read-only", used until `/health` answers and if it cannot
 * be reached. That is the safe direction: a SPA that wrongly believes it may
 * write shows a button and surfaces the server's refusal, while one that
 * wrongly believes it may not hides a working feature and looks broken.
 */
import { computed, ref } from 'vue';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';

const readOnly = ref(false);
const resolved = ref(false);
let loading: Promise<void> | null = null;

function apiBase(): string {
  const config = useRuntimeConfig();
  return String(config.public.apiBaseUrl ?? '').replace(/\/$/, '');
}

export function useDeploymentMode() {
  /** Asks once per page load. A failure leaves the default in place. */
  const ensureLoaded = (): Promise<void> => {
    loading ??= (async () => {
      try {
        const response = await fetch(`${apiBase()}/health`);
        // 503 is "cache not ready", which still carries the mode.
        const payload = (await response.json()) as { readOnly?: unknown };
        readOnly.value = payload.readOnly === true;
        resolved.value = true;
      } catch {
        // The default stands. The server still has the last word on any write.
      }
    })();
    return loading;
  };

  return {
    isReadOnly: computed(() => readOnly.value),
    /** True once `/health` has answered, for a caller that wants to wait. */
    isResolved: computed(() => resolved.value),
    ensureLoaded,
  };
}

/** For tests, which must not inherit a previous file's answer. */
export function resetDeploymentMode(): void {
  readOnly.value = false;
  resolved.value = false;
  loading = null;
}
