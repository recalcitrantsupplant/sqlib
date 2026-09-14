/**
 * Reading a tuple set with the **Tuples** section switched off.
 *
 * `tupleSets` draws a rail section. It does not decide whether a tuple set
 * exists, and the server says so by registering `/tuple-sets` without
 * consulting the flag — with the reason written above the registration: "gating
 * it would leave argument sets referencing versions nothing could resolve."
 *
 * The browser refused all thirteen calls anyway, which produced exactly that
 * state on the one side that cannot afford it. `useArgumentSets.referenceRows`
 * sends *values* for a draft run, and deliberately contributes nothing for a
 * reference it could not resolve — so with `FEATURE_TUPLE_SETS=0` a clause
 * backed by a tuple set ran against fewer rows and reported nothing. A silent
 * wrong answer, not an error.
 *
 * So the four reads no longer ask, and the writes still do: authoring a record
 * in a section this build does not draw is the thing the flag is about.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useApiClient } from '@/composables/useApiClient';

const SET = 'urn:sqlib:tuple-set:cities';

const tupleSet = {
  id: SET,
  name: 'Cities',
  isPartOf: ['urn:sqlib:library:1'],
  currentVersion: 'urn:sqlib:tuple-set-version:cities-2',
};

const tupleSetVersion = {
  id: 'urn:sqlib:tuple-set-version:cities-2',
  isPartOf: SET,
  version: 2,
  contentString: JSON.stringify({ head: { vars: ['city'] }, results: { bindings: [] } }),
};

function respondWith(body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function setFlags(flags: Record<string, boolean> | null): void {
  globalThis.__NUXT_TEST_CONFIG__ = flags === null
    ? undefined
    : { public: { apiBaseUrl: 'http://api.test', featureFlags: flags } };
}

describe('reading an input entity whose section is switched off', () => {
  beforeEach(() => setFlags({ tupleSets: false }));

  afterEach(() => {
    setFlags(null);
    vi.unstubAllGlobals();
  });

  it('lists tuple sets', async () => {
    vi.stubGlobal('fetch', respondWith([tupleSet]));
    await expect(useApiClient().listTupleSets({ library: 'urn:sqlib:library:1' }))
      .resolves.toHaveLength(1);
  });

  it('reads one tuple set', async () => {
    vi.stubGlobal('fetch', respondWith(tupleSet));
    const { data } = await useApiClient().getTupleSet(SET);
    expect(data.id).toBe(SET);
  });

  it('lists a tuple set\'s versions', async () => {
    vi.stubGlobal('fetch', respondWith([tupleSetVersion]));
    await expect(useApiClient().listTupleSetVersions(SET)).resolves.toHaveLength(1);
  });

  it('reads the version a reference pins, which is the whole point', async () => {
    // The read behind `resolveReferences`. Without it the rows below are absent
    // from a draft run and nothing says so.
    vi.stubGlobal('fetch', respondWith(tupleSetVersion));
    const { data } = await useApiClient().getTupleSetVersion(SET, 2);
    expect(data.version).toBe(2);
  });

  it('still refuses to author one', async () => {
    // The backstop behind the doors, which are absent rather than disabled.
    // Nothing should reach this, and reaching it must not write.
    const fetchMock = respondWith(tupleSet);
    vi.stubGlobal('fetch', fetchMock);
    // Thrown before the promise, which is the point: nothing is sent.
    expect(() => useApiClient().createTupleSet({ name: 'Cities', isPartOf: ['urn:sqlib:library:1'] }))
      .toThrow(/Tuple sets feature is disabled/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a data graph, which was never gated and is the shape being matched', async () => {
    setFlags({ dataGraphs: false });
    vi.stubGlobal('fetch', respondWith([]));
    await expect(useApiClient().listDataGraphs()).resolves.toEqual([]);
  });
});
