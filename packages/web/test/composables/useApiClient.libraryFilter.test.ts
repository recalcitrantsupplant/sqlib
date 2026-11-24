/**
 * The list calls send the library they are for as `?library=` (#250), so the
 * server answers with one library's rows. Without a library they ask for
 * every readable row, as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useApiClient } from '@/composables/useApiClient';

const LIBRARY = 'urn:sqlib:library:hydrology';

function respondWithEmptyList() {
  return vi.fn().mockImplementation(async () => new Response('[]', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}

describe('list calls with a library', () => {
  let fetchMock: ReturnType<typeof respondWithEmptyList>;

  beforeEach(() => {
    globalThis.__NUXT_TEST_CONFIG__ = { public: { apiBaseUrl: 'http://api.test', featureFlags: {} } };
    fetchMock = respondWithEmptyList();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    globalThis.__NUXT_TEST_CONFIG__ = undefined;
    vi.unstubAllGlobals();
  });

  const urlOf = (call: number) => new URL(String(fetchMock.mock.calls[call][0]));

  const calls: Array<[string, string, (client: ReturnType<typeof useApiClient>, library?: string) => Promise<unknown>]> = [
    ['listQueries', '/queries', (client, library) => client.listQueries({ library })],
    ['listQueryGroups', '/query-groups', (client, library) => client.listQueryGroups({ library })],
    ['listRules', '/rules', (client, library) => client.listRules({ library })],
    ['listRuleSets', '/rule-sets', (client, library) => client.listRuleSets({ library })],
    ['listNotebooks', '/notebooks', (client, library) => client.listNotebooks({ library })],
    ['listDataGraphs', '/data-graphs', (client, library) => client.listDataGraphs({ library })],
    ['listDataBlocks', '/data-blocks', (client, library) => client.listDataBlocks({ library })],
    ['listTupleSets', '/tuple-sets', (client, library) => client.listTupleSets({ library })],
    ['listTests', '/tests', (client, library) => client.listTests({ library })],
    ['listBenchmarkExperiments', '/benchmark-experiments', (client, library) => client.listBenchmarkExperiments({ library })],
  ];

  it.each(calls)('%s sends ?library= when it has one', async (_name, path, call) => {
    await call(useApiClient(), LIBRARY);
    const url = urlOf(0);
    expect(url.pathname.endsWith(path)).toBe(true);
    expect(url.searchParams.get('library')).toBe(LIBRARY);
  });

  it.each(calls)('%s sends no filter without a library', async (_name, path, call) => {
    await call(useApiClient());
    const url = urlOf(0);
    expect(url.pathname.endsWith(path)).toBe(true);
    expect(url.search).toBe('');
  });
});
