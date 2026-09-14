import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A query the app reads but never opens in an editor still teaches its
 * prefixes: the version list, a group node's preview, the side of a diff.
 */
const autoDiscoverFromText = vi.fn();

vi.mock('@/composables/usePrefixManager', () => ({
  usePrefixManager: () => ({ autoDiscoverFromText }),
}));

const { discoverQueryVersionPrefixes, queryStringsFrom } = await import('@/lib/queryVersionPrefixes');

const QUERY_ID = 'urn:sqlib:query:1';
const SPARQL = 'PREFIX ex: <http://example.org/>\nSELECT * WHERE { ?s ?p ?o }';

describe('discoverQueryVersionPrefixes', () => {
  beforeEach(() => {
    autoDiscoverFromText.mockClear();
  });

  it('reads a bare version, as the version list returns it', () => {
    discoverQueryVersionPrefixes({ id: `${QUERY_ID}:v1`, queryString: SPARQL }, QUERY_ID);

    expect(autoDiscoverFromText).toHaveBeenCalledWith(SPARQL, `query:${QUERY_ID}`);
  });

  it('reads a version nested under `queryVersion`, as the single-version routes return it', () => {
    discoverQueryVersionPrefixes({ queryVersion: { queryString: SPARQL }, inputs: [] }, QUERY_ID);

    expect(autoDiscoverFromText).toHaveBeenCalledWith(SPARQL, `query:${QUERY_ID}`);
  });

  it('reads every version of a list', () => {
    const second = 'PREFIX other: <http://other.example/> ASK { ?s ?p ?o }';
    discoverQueryVersionPrefixes([{ queryString: SPARQL }, { queryString: second }], QUERY_ID);

    expect(autoDiscoverFromText).toHaveBeenCalledTimes(2);
    expect(autoDiscoverFromText).toHaveBeenNthCalledWith(1, SPARQL, `query:${QUERY_ID}`);
    expect(autoDiscoverFromText).toHaveBeenNthCalledWith(2, second, `query:${QUERY_ID}`);
  });

  it('records provenance against the query, not the version', () => {
    discoverQueryVersionPrefixes({ id: `${QUERY_ID}:v7`, queryString: SPARQL }, QUERY_ID);

    expect(autoDiscoverFromText).toHaveBeenCalledWith(SPARQL, `query:${QUERY_ID}`);
  });

  it('discovers with no provenance when the query has no id', () => {
    discoverQueryVersionPrefixes({ queryString: SPARQL }, null);

    expect(autoDiscoverFromText).toHaveBeenCalledWith(SPARQL, null);
  });

  it('does nothing for a payload carrying no query text', () => {
    discoverQueryVersionPrefixes({ queryVersion: { queryString: '   ' } }, QUERY_ID);
    discoverQueryVersionPrefixes([], QUERY_ID);
    discoverQueryVersionPrefixes(null, QUERY_ID);

    expect(autoDiscoverFromText).not.toHaveBeenCalled();
  });
});

describe('queryStringsFrom', () => {
  it('skips entries with nothing to read rather than failing the batch', () => {
    expect(queryStringsFrom([{ queryString: SPARQL }, null, { comment: 'no text here' }])).toEqual([SPARQL]);
  });
});
