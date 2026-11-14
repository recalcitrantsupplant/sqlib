/**
 * Loading state that tells a first load from a reload.
 *
 * A view that already shows data must keep it in place while the same data
 * reloads. A loading line or a spinner that appears above the rows, or that
 * replaces them, makes the rows move and come back on every save. The
 * backends list did that each time a backend's query method changed.
 *
 * - `loading` is true while any load runs. Use it to hold off a second
 *   request or to disable a control. Do not use it to choose what to render.
 * - `initialLoading` is true while a load runs and nothing for the current
 *   subject has loaded yet. This is the only flag a template may use to show
 *   loading text in place of data.
 *
 * The subject is the `key` given to `track`: a library id, a backend id, a
 * run id. A load for a new key is a first load again, so the view does not
 * show the previous subject's data under the new subject's name. A view that
 * clears its data itself can call `reset()` instead.
 *
 * `test/loadingOnlyBeforeData.test.ts` fails a template that renders on a raw
 * loading flag.
 */
import { computed, ref, type ComputedRef } from 'vue';

/** The key `track` uses when a view has one subject only. */
const ONLY = Symbol('only subject');
const NONE = Symbol('nothing loaded');

type Key = string | number | symbol | null | undefined;

export interface LoadState {
  /** True while any load runs. */
  loading: ComputedRef<boolean>;
  /** True while a load runs and the current subject has not loaded yet. */
  initialLoading: ComputedRef<boolean>;
  /** True once the current subject has loaded at least once. */
  loaded: ComputedRef<boolean>;
  /** Run one load. A load that throws leaves the subject as it was. */
  track: <T>(work: () => Promise<T>, key?: Key) => Promise<T>;
  /**
   * Start one load and return the call that ends it, for a `try … finally`.
   * Pass `false` to the end call when the load failed.
   */
  start: (key?: Key) => (succeeded?: boolean) => void;
  /** Make the next load a first load. */
  reset: () => void;
}

export function useLoadState(): LoadState {
  const pending = ref(0);
  const requested = ref<Key>(ONLY);
  const loadedKey = ref<Key>(NONE);

  const loading = computed(() => pending.value > 0);
  const loaded = computed(() => loadedKey.value === requested.value);
  const initialLoading = computed(() => loading.value && !loaded.value);

  function start(key: Key = ONLY) {
    requested.value = key;
    pending.value += 1;
    let ended = false;
    return (succeeded = true) => {
      if (ended) return;
      ended = true;
      pending.value -= 1;
      // A slower load for an earlier subject does not mark the current one.
      if (succeeded && requested.value === key) loadedKey.value = key;
    };
  }

  async function track<T>(work: () => Promise<T>, key: Key = ONLY): Promise<T> {
    const end = start(key);
    let succeeded = false;
    try {
      const result = await work();
      succeeded = true;
      return result;
    } finally {
      end(succeeded);
    }
  }

  function reset() {
    loadedKey.value = NONE;
  }

  return { loading, initialLoading, loaded, track, start, reset };
}
