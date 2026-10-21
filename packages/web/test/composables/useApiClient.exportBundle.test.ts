/**
 * What the export call asks for. The server carries ETL jobs and rule sets
 * unless told not to, so the client says so only when a toggle is off.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useApiClient } from '@/composables/useApiClient';

const LIBRARY = 'urn:sqlib:library:1';

function recordingFetch() {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ bundle: { version: 1, library: { id: LIBRARY }, queries: {} }, skipped: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const requestedParams = (fetch: ReturnType<typeof vi.fn>) =>
  new URL(String(fetch.mock.calls[0]![0])).searchParams;

describe('getLibraryExportBundle', () => {
  afterEach(() => {
    globalThis.__NUXT_TEST_CONFIG__ = undefined;
    vi.unstubAllGlobals();
  });

  it('leaves the members to the server when nothing is turned off', async () => {
    globalThis.__NUXT_TEST_CONFIG__ = { public: { apiBaseUrl: 'http://api.test' } };
    const fetch = recordingFetch();
    vi.stubGlobal('fetch', fetch);
    await useApiClient().getLibraryExportBundle(LIBRARY, { examples: 'all', etl: true, ruleSets: true });
    const params = requestedParams(fetch);
    expect(params.has('etl')).toBe(false);
    expect(params.has('ruleSets')).toBe(false);
  });

  it('asks for a bundle without ETL jobs or rule sets', async () => {
    globalThis.__NUXT_TEST_CONFIG__ = { public: { apiBaseUrl: 'http://api.test' } };
    const fetch = recordingFetch();
    vi.stubGlobal('fetch', fetch);
    await useApiClient().getLibraryExportBundle(LIBRARY, { etl: false, ruleSets: false });
    const params = requestedParams(fetch);
    expect(params.get('etl')).toBe('false');
    expect(params.get('ruleSets')).toBe('false');
  });
});
