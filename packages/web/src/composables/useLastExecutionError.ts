/**
 * The last execution error the user saw, so the assistant can be told about it.
 *
 * Third of the three facts issue #128 item 2 names — and the only one that is
 * not already somewhere a screen can reach. An error raised by Try it lives in
 * that component; the chat rail is three levels away and holds none of the
 * state that produced it. Rather than thread an emit through
 * `CallableTryIt → CallableDetail → CallableTable → build.vue`, the run reports
 * it here and whoever assembles a screen context reads it.
 *
 * **Keyed by the entity it belongs to**, which is the point. A module-level
 * "last error" with no owner outlives the thing that failed: close the query,
 * open another, and the assistant is told about an error the user cannot see.
 * A reader asks for the error *of the entity it is describing*, so a stale one
 * simply does not match and is not sent.
 *
 * One entry, not a map: what is wanted is the error in front of the user, and
 * that is the most recent one. A history would be a different feature with a
 * different question behind it.
 */
import { computed, ref } from 'vue';

export interface LastExecutionError {
  /** The callable, query or group whose run failed. */
  targetId: string;
  message: string;
  at: string;
}

const lastError = ref<LastExecutionError | null>(null);

export function useLastExecutionError() {
  /**
   * Record — or clear — the outcome of a run.
   *
   * Called with `null` on a run that starts or succeeds, because "the last
   * error the user saw" stops being true the moment the same thing works.
   */
  function report(targetId: string, message: string | null): void {
    if (!message) {
      // Only the entity that owns the entry may clear it: a different one
      // succeeding says nothing about whether this error is still on screen.
      if (lastError.value?.targetId === targetId) lastError.value = null;
      return;
    }
    lastError.value = { targetId, message, at: new Date().toISOString() };
  }

  /** The error for this entity, or null when the stored one belongs elsewhere. */
  function errorFor(targetId: string | null | undefined): string | null {
    if (!targetId) return null;
    return lastError.value?.targetId === targetId ? lastError.value.message : null;
  }

  /** Drop everything, for a screen that is going away. */
  function clear(): void {
    lastError.value = null;
  }

  return { lastError: computed(() => lastError.value), report, errorFor, clear };
}
