/**
 * The caps the SPA states and refuses uploads at, read from the server.
 *
 * Both are environment variables on the API, so a copy in the web package is a
 * copy that goes stale: a deployment that raises the server's per-version cap
 * would still have the UI refusing files at the old figure, and saying the old
 * figure while it did.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useServerLimits, resetServerLimits } from '@/composables/useServerLimits';

const fetchMock = vi.fn();

beforeEach(() => {
  resetServerLimits();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('useServerLimits', () => {
  it('takes both caps from /health', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ limits: { dataGraphVersionBytes: 10_485_760, dataGraphLibraryBytes: 104_857_600 } }),
    });

    const { limits, ensureLoaded } = useServerLimits();
    await ensureLoaded();

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/health$/);
    expect(limits.value).toEqual({
      dataGraphVersionBytes: 10_485_760,
      dataGraphLibraryBytes: 104_857_600,
    });
  });

  it('asks once, however many components want the answer', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ limits: { dataGraphVersionBytes: 2048, dataGraphLibraryBytes: 4096 } }) });

    await Promise.all([
      useServerLimits().ensureLoaded(),
      useServerLimits().ensureLoaded(),
    ]);
    await useServerLimits().ensureLoaded();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /*
   * A cap of 0 would be an unusable UI that refuses every file, so a malformed
   * or missing figure falls back rather than being believed.
   */
  it('keeps the server defaults when the answer is unusable', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ limits: { dataGraphVersionBytes: 'lots' } }) });

    const { limits, ensureLoaded } = useServerLimits();
    await ensureLoaded();

    expect(limits.value).toEqual({
      dataGraphVersionBytes: 1_048_576,
      dataGraphLibraryBytes: 16_777_216,
    });
  });

  it('keeps them when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    const { limits, ensureLoaded } = useServerLimits();
    await ensureLoaded();

    expect(limits.value.dataGraphVersionBytes).toBe(1_048_576);
  });
});
