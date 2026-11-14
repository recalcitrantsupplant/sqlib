import { computed, ref } from 'vue';
import { useRuntimeConfig } from '#imports';

/**
 * The round trip from this browser to the sqlib API.
 *
 * The web UI makes several requests in sequence for one screen, so a distant
 * server makes every screen slow. The landing screen warns at
 * `SLOW_ROUND_TRIP_MS` or more, and Settings shows the number.
 *
 * The measurement times `GET /health`, which does no work on the server.
 * The first request also opens the connection, so it is discarded. The median
 * of the rest is the result. Server-Timing is not subtracted: a proxy in front
 * of sqlib (such as the Cloudflare edge on the demo) reports its hop to the
 * container there, and that hop is part of the distance.
 *
 * The result stays in this browser. Nothing is sent back.
 */

/** Same-continent round trips are usually below this. */
export const SLOW_ROUND_TRIP_MS = 100;

/** Requests after the discarded first one. */
const SAMPLES = 3;

const roundTripMs = ref<number | null>(null);
const location = ref<string | null>(null);
const measuring = ref(false);
let inFlight: Promise<void> | null = null;

function apiBase(): string {
  const config = useRuntimeConfig();
  return String(config.public.apiBaseUrl ?? '').replace(/\/$/, '');
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

async function timeOne(url: string): Promise<{ ms: number; payload: unknown }> {
  const started = performance.now();
  const response = await fetch(url, { cache: 'no-store' });
  const payload: unknown = await response.json().catch(() => null);
  return { ms: performance.now() - started, payload };
}

async function run(): Promise<void> {
  measuring.value = true;
  try {
    const url = `${apiBase()}/health`;
    const first = await timeOne(url);
    const times: number[] = [];
    for (let i = 0; i < SAMPLES; i++) times.push((await timeOne(url)).ms);
    roundTripMs.value = Math.round(median(times));
    const reported = (first.payload as { location?: unknown } | null)?.location;
    location.value = typeof reported === 'string' && reported.trim() ? reported.trim() : null;
  } catch {
    // Unreachable is shown elsewhere. Keep the last number.
  } finally {
    measuring.value = false;
    inFlight = null;
  }
}

export function useServerLatency() {
  /** Measure once per page load. */
  const ensureMeasured = (): Promise<void> => {
    if (roundTripMs.value !== null) return Promise.resolve();
    inFlight ??= run();
    return inFlight;
  };

  /** Measure now, for `Measure again`. */
  const measure = (): Promise<void> => {
    inFlight ??= run();
    return inFlight;
  };

  return {
    roundTripMs: computed(() => roundTripMs.value),
    location: computed(() => location.value),
    isSlow: computed(() => roundTripMs.value !== null && roundTripMs.value >= SLOW_ROUND_TRIP_MS),
    measuring: computed(() => measuring.value),
    ensureMeasured,
    measure,
  };
}

/** For tests, which must not inherit a previous file's answer. */
export function resetServerLatency(): void {
  roundTripMs.value = null;
  location.value = null;
  measuring.value = false;
  inFlight = null;
}
