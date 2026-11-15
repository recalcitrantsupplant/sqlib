/**
 * The browser-to-sqlib round trip: the first request is discarded, the median
 * of the next three is the result, and 100 ms or more counts as slow.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { median, resetServerLatency, useServerLatency, SLOW_ROUND_TRIP_MS } from '@/composables/useServerLatency';

const realFetch = globalThis.fetch;

/** A fetch whose nth call takes `delays[n]` ms of `performance.now()` time. */
function stubTimedFetch(delays: number[], payload: unknown = { status: 'ok', location: null }) {
  let now = 0;
  let call = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const fetchMock = vi.fn(async () => {
    now += delays[call++] ?? 0;
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('useServerLatency', () => {
  beforeEach(() => resetServerLatency());
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('takes the median of three requests after the first', async () => {
    const fetchMock = stubTimedFetch([900, 340, 360, 350]);
    const latency = useServerLatency();
    await latency.ensureMeasured();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(latency.roundTripMs.value).toBe(350);
    expect(latency.isSlow.value).toBe(true);
  });

  it('is not slow below the threshold', async () => {
    stubTimedFetch([200, 20, 30, 25]);
    const latency = useServerLatency();
    await latency.ensureMeasured();
    expect(latency.roundTripMs.value).toBe(25);
    expect(latency.isSlow.value).toBe(false);
    expect(SLOW_ROUND_TRIP_MS).toBe(100);
  });

  it('measures once per page load, and again on request', async () => {
    const fetchMock = stubTimedFetch([10, 10, 10, 10, 10, 10, 10, 10]);
    const latency = useServerLatency();
    await latency.ensureMeasured();
    await latency.ensureMeasured();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await latency.measure();
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('reads the location the server reports', async () => {
    stubTimedFetch([1, 1, 1, 1], { status: 'ok', location: '  Sydney ' });
    const latency = useServerLatency();
    await latency.ensureMeasured();
    expect(latency.location.value).toBe('Sydney');
  });

  it('keeps no result when the server cannot be reached', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const latency = useServerLatency();
    await latency.ensureMeasured();
    expect(latency.roundTripMs.value).toBeNull();
    expect(latency.isSlow.value).toBe(false);
  });
});

describe('median', () => {
  it('takes the middle value, or the mean of the two middle values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
