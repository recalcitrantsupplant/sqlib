/**
 * Which runs are pinned, and so cacheable (#206).
 */
import { afterEach, describe, it, expect } from 'vitest';
import {
  setPinnedHeaders,
  matchesIfNoneMatch,
  pinBackendData,
  pinQueryAndArguments,
  pinnedEtag,
} from '../../src/lib/pinnedCaching.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';

const entities: Record<string, unknown> = {
  'urn:q': { '@type': 'Query', currentVersion: 'urn:q:v1' },
  'urn:q:v1': { '@type': 'QueryVersion', queryType: QueryTypeIri.select },
  'urn:u:v1': { '@type': 'QueryVersion', queryType: QueryTypeIri.update },
  'urn:as': { '@type': 'ArgumentSet' },
  'urn:as:v1': { '@type': 'ArgumentSetVersion' },
};
const lookup = (id: string) => entities[id] ?? null;

const backend = (config: unknown, extra: Record<string, unknown> = {}) => (id: string) =>
  id === 'urn:b'
    ? { '@type': 'Backend', backendType: BackendTypeIri.oxigraphMemory, oxigraphConfig: JSON.stringify(config), ...extra }
    : null;

describe('pinQueryAndArguments', () => {
  it('pins a query version with argument-set versions', () => {
    expect(pinQueryAndArguments(lookup, { targetId: 'urn:q:v1', argumentSetIds: ['urn:as:v1'] })).toEqual({
      pinned: true,
      pins: { target: 'urn:q:v1', argumentSets: ['urn:as:v1'] },
    });
  });

  it.each([
    ['a query, whose current version moves', { targetId: 'urn:q' }],
    ['an argument set, whose current version moves', { targetId: 'urn:q:v1', argumentSetIds: ['urn:as'] }],
    ['inline arguments', { targetId: 'urn:q:v1', inlineArguments: [{ head: { vars: ['x'] } }] }],
    ['an update', { targetId: 'urn:u:v1' }],
    ['an unknown target', { targetId: 'urn:none' }],
  ])('does not pin %s', (_, input) => {
    expect(pinQueryAndArguments(lookup, input).pinned).toBe(false);
  });
});

describe('pinBackendData', () => {
  it('pins a read-only store whose every source names a data-graph version', () => {
    const result = pinBackendData(
      backend({ storeType: 'ephemeral', mode: 'readOnly', sources: [{ dataGraphVersionId: 'urn:dg:v3' }] }),
      'urn:b',
    );
    expect(result).toEqual({
      pinned: true,
      pins: { backend: 'urn:b', dataGraphVersions: [{ version: 'urn:dg:v3', namedGraph: null }] },
    });
  });

  it('reads an absent mode as read-only, as the store manager does', () => {
    expect(pinBackendData(backend({ storeType: 'ephemeral', sources: [] }), 'urn:b').pinned).toBe(true);
  });

  it.each([
    ['a source that tracks a data graph', { mode: 'readOnly', sources: [{ dataGraphId: 'urn:dg' }] }],
    ['a writable store', { mode: 'durable', sources: [] }],
    ['an external load', { mode: 'readOnly', loadMethod: 'remote-sparql', sources: [] }],
  ])('does not pin %s', (_, config) => {
    expect(pinBackendData(backend({ storeType: 'ephemeral', ...config }), 'urn:b').pinned).toBe(false);
  });

  it('does not pin an HTTP endpoint', () => {
    const http = (id: string) => (id === 'urn:b' ? { '@type': 'Backend', backendType: BackendTypeIri.http } : null);
    expect(pinBackendData(http, 'urn:b').pinned).toBe(false);
  });

  it('does not pin a backend with a graph policy, which reads grants', () => {
    const lookupWithPolicy = backend({ mode: 'readOnly', sources: [] }, { graphPolicyQueryVersion: 'urn:p:v1' });
    expect(pinBackendData(lookupWithPolicy, 'urn:b').pinned).toBe(false);
  });
});

describe('ETags', () => {
  it('differ when any part differs, and match through If-None-Match', () => {
    const a = pinnedEtag({ target: 'urn:q:v1', accept: 'application/json', caller: 'everyone' });
    const b = pinnedEtag({ target: 'urn:q:v1', accept: 'text/csv', caller: 'everyone' });
    expect(a).not.toBe(b);
    expect(matchesIfNoneMatch(`"other", ${a}`, a)).toBe(true);
    expect(matchesIfNoneMatch(`W/${a}`, a)).toBe(true);
    expect(matchesIfNoneMatch('*', a)).toBe(true);
    expect(matchesIfNoneMatch(b, a)).toBe(false);
    expect(matchesIfNoneMatch(undefined, a)).toBe(false);
  });
});

describe('setPinnedHeaders', () => {
  function headersFor(scope: 'public' | 'private') {
    const headers: Record<string, string> = {};
    const reply = { header: (name: string, value: string) => { headers[name] = value; } };
    setPinnedHeaders(reply as never, '"p1-x"', scope);
    return headers;
  }

  afterEach(() => {
    delete process.env.SQLIB_PINNED_CACHE_MAX_AGE;
  });

  it('lets every cache keep a public answer for a year', () => {
    expect(headersFor('public')['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  it('keeps a public answer for SQLIB_PINNED_CACHE_MAX_AGE seconds', () => {
    process.env.SQLIB_PINNED_CACHE_MAX_AGE = '3600';
    expect(headersFor('public')['Cache-Control']).toBe('public, max-age=3600, immutable');
  });

  it('makes every cache revalidate a public answer when SQLIB_PINNED_CACHE_MAX_AGE is 0', () => {
    process.env.SQLIB_PINNED_CACHE_MAX_AGE = '0';
    const headers = headersFor('public');
    expect(headers['Cache-Control']).toBe('public, no-cache');
    expect(headers.ETag).toBe('"p1-x"');
  });

  it.each(['-1', '1.5', 'week', '31536001'])('uses a year for SQLIB_PINNED_CACHE_MAX_AGE=%s', raw => {
    process.env.SQLIB_PINNED_CACHE_MAX_AGE = raw;
    expect(headersFor('public')['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  it('keeps a private answer at no-cache whatever SQLIB_PINNED_CACHE_MAX_AGE says', () => {
    process.env.SQLIB_PINNED_CACHE_MAX_AGE = '3600';
    expect(headersFor('private')['Cache-Control']).toBe('private, no-cache');
  });

  it('makes a browser revalidate a private answer, so the next person to sign in does not see it', () => {
    const headers = headersFor('private');
    expect(headers['Cache-Control']).toBe('private, no-cache');
    expect(headers.ETag).toBe('"p1-x"');
  });
});
