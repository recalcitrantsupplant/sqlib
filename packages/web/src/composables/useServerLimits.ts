import { ref } from 'vue';
// @ts-ignore - Nuxt auto-import
import { useRuntimeConfig } from '#imports';

/**
 * What the server will accept, read from the server.
 *
 * Both data graph caps are environment variables on the API
 * (`DATA_GRAPH_MAX_VERSION_BYTES`, `DATA_GRAPH_MAX_LIBRARY_BYTES`), so the
 * figure the UI states and the figure an upload is refused at have to come from
 * the same place. The SPA used to carry its own copy of the per-version cap,
 * which meant a deployment that raised the server's still had a UI refusing
 * uploads at the old one.
 *
 * The values below are the server's own defaults, used until `/health` answers
 * and if it cannot be reached. Refusing an oversized file early is the point of
 * holding them at all: reading half a gigabyte into a string to be told no is a
 * hung tab rather than a validation message.
 */
export interface ServerLimits {
  /** Bytes allowed in one data graph version. */
  dataGraphVersionBytes: number;
  /** Bytes allowed across every data graph version in one library. */
  dataGraphLibraryBytes: number;
  /** Bytes allowed in one tuple set version. */
  tupleSetVersionBytes: number;
  /** Bytes allowed across every tuple set version in one library. */
  tupleSetLibraryBytes: number;
}

const DEFAULTS: ServerLimits = {
  dataGraphVersionBytes: 1_048_576,
  dataGraphLibraryBytes: 16_777_216,
  tupleSetVersionBytes: 1_048_576,
  tupleSetLibraryBytes: 16_777_216,
};

const limits = ref<ServerLimits>({ ...DEFAULTS });
let loading: Promise<void> | null = null;

function apiBase(): string {
  const config = useRuntimeConfig();
  return String(config.public.apiBaseUrl ?? '').replace(/\/$/, '');
}

export function useServerLimits() {
  /** Asks once per page load. A failure leaves the defaults in place. */
  const ensureLoaded = (): Promise<void> => {
    loading ??= (async () => {
      try {
        const response = await fetch(`${apiBase()}/health`);
        // 503 is "cache not ready", which still carries the limits.
        const payload = (await response.json()) as { limits?: Partial<ServerLimits> };
        const answered = payload.limits ?? {};
        // Key by key, with the server's own default behind each: a build of the
        // SPA newer than the API it is talking to asks for a cap that API does
        // not report yet, and a zero would be a UI that refuses every file.
        const resolved = { ...DEFAULTS };
        for (const key of Object.keys(DEFAULTS) as Array<keyof ServerLimits>) {
          resolved[key] = Number(answered[key]) || DEFAULTS[key];
        }
        limits.value = resolved;
      } catch {
        // The defaults stand; an upload is still bounded, and the server has
        // the last word on any file that passes.
      }
    })();
    return loading;
  };

  return { limits, ensureLoaded };
}

/** For tests: forgets the answer so the next call asks again. */
export function resetServerLimits(): void {
  loading = null;
  limits.value = { ...DEFAULTS };
}
