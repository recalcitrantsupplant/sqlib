/**
 * The kept-result cache: what keeps it a cache rather than storage.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ResultCache, ResultRefError, setResultCache } from '../../src/lib/resultCache.js';
import { resolveArgumentRef, resolveGraphRef } from '../../src/lib/resultRefs.js';

const LIMITS = { maxBytes: 100, maxBytesPerOwner: 40, ttlMs: 1000 };

function clock() {
  let now = 0;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe('ResultCache', () => {
  it('reads a handle back for its owner only, as if missing for anyone else', () => {
    const cache = new ResultCache(LIMITS);
    const handle = cache.put('alice', 'abc', 'text/plain')!;
    expect(cache.get('alice', handle).body).toBe('abc');
    expect(() => cache.get('bob', handle)).toThrow(ResultRefError);
  });

  it('expires an entry a fixed time after it was last used', () => {
    const time = clock();
    const cache = new ResultCache(LIMITS, time.now);
    const handle = cache.put('alice', 'abc', 'text/plain')!;
    time.advance(900);
    cache.get('alice', handle);
    time.advance(900);
    expect(cache.get('alice', handle).body).toBe('abc');
    time.advance(1001);
    expect(() => cache.get('alice', handle)).toThrow(/expired/);
  });

  it('keeps each owner under their quota by dropping their own oldest first', () => {
    const time = clock();
    const cache = new ResultCache(LIMITS, time.now);
    const first = cache.put('alice', 'x'.repeat(30), 'text/plain')!;
    time.advance(1);
    const other = cache.put('bob', 'y'.repeat(30), 'text/plain')!;
    time.advance(1);
    const second = cache.put('alice', 'z'.repeat(30), 'text/plain')!;

    expect(() => cache.get('alice', first)).toThrow(ResultRefError);
    expect(cache.get('alice', second).bytes).toBe(30);
    expect(cache.get('bob', other).bytes).toBe(30);
    expect(cache.usage('alice')).toBe(30);
  });

  it('keeps the whole cache under its cap', () => {
    const cache = new ResultCache(LIMITS);
    for (const owner of ['a', 'b', 'c', 'd']) cache.put(owner, 'x'.repeat(30), 'text/plain');
    expect(cache.usage()).toBeLessThanOrEqual(100);
  });

  it('does not keep a body over the quota, and keeps nothing when turned off', () => {
    expect(new ResultCache(LIMITS).put('alice', 'x'.repeat(41), 'text/plain')).toBeNull();
    const off = new ResultCache({ ...LIMITS, maxBytes: 0 });
    expect(off.put('alice', 'abc', 'text/plain')).toBeNull();
  });
});

describe('resolving a kept result', () => {
  afterEach(() => setResultCache(null));

  it('renames a SELECT result\'s columns to a slot\'s variables, dropping the rest', () => {
    const shared = new ResultCache({ ...LIMITS, maxBytesPerOwner: 10_000, maxBytes: 10_000 });
    setResultCache(shared);
    const body = JSON.stringify({
      head: { vars: ['city', 'label'] },
      results: { bindings: [{ city: { type: 'uri', value: 'urn:perth' }, label: { type: 'literal', value: 'Perth' } }] },
    });
    const handle = shared.put('alice', body, 'application/sparql-results+json')!;

    expect(resolveArgumentRef('alice', { resultRef: handle, columns: [{ from: 'city', to: 'place' }] })).toEqual({
      head: { vars: ['place'] },
      results: { bindings: [{ place: { type: 'uri', value: 'urn:perth' } }] },
    });
    expect(() => resolveArgumentRef('alice', { resultRef: handle, columns: [{ from: 'nope', to: 'x' }] })).toThrow(/no column/);
  });

  it('hands a kept graph back as inline RDF, and refuses a format a run cannot read', () => {
    const shared = new ResultCache({ ...LIMITS, maxBytesPerOwner: 10_000, maxBytes: 10_000 });
    setResultCache(shared);
    const graph = shared.put('alice', '<urn:a> <urn:p> <urn:b> .', 'application/n-triples; charset=utf-8')!;
    expect(resolveGraphRef('alice', graph)).toEqual({ dataGraphInline: '<urn:a> <urn:p> <urn:b> .', dataGraphInlineFormat: 'application/n-triples' });

    const jsonLd = shared.put('alice', '{}', 'application/ld+json')!;
    expect(() => resolveGraphRef('alice', jsonLd)).toThrow(/ld\+json/);
  });
});
