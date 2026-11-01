/**
 * Resolving a kept result's handle into the inline shape a run takes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ResultCache, ResultRefError, setResultCache } from '../../src/lib/resultCache.js';
import { resolveArgumentRef, resolveGraphRef, resolveRequestRefs } from '../../src/lib/resultRefs.js';
import { ValidationError } from '../../src/lib/validationError.js';

const LIMITS = { maxBytes: 1_000_000, maxBytesPerOwner: 100_000, ttlMs: 60_000 };
let cache: ResultCache;

const srj = JSON.stringify({
  head: { vars: ['person', 'name'] },
  results: {
    bindings: [
      { person: { type: 'uri', value: 'urn:p:1' }, name: { type: 'literal', value: 'Ada' } },
      { person: { type: 'uri', value: 'urn:p:2' } },
    ],
  },
});

beforeEach(() => {
  cache = new ResultCache(LIMITS);
  setResultCache(cache);
});
afterEach(() => setResultCache(null));

describe('resolveArgumentRef', () => {
  it('renames the paired columns and drops the rest', () => {
    const handle = cache.put('alice', srj, 'application/sparql-results+json')!;
    const argument = resolveArgumentRef('alice', { resultRef: handle, columns: [{ from: 'person', to: 'who' }] });
    expect(argument.head.vars).toEqual(['who']);
    expect(argument.results.bindings).toEqual([{ who: { type: 'uri', value: 'urn:p:1' } }, { who: { type: 'uri', value: 'urn:p:2' } }]);
  });

  it('refuses a column the result does not have', () => {
    const handle = cache.put('alice', srj, 'application/sparql-results+json')!;
    expect(() => resolveArgumentRef('alice', { resultRef: handle, columns: [{ from: 'age', to: 'age' }] })).toThrow(ValidationError);
  });

  it('refuses a graph where rows are expected', () => {
    const handle = cache.put('alice', '<urn:a> <urn:p> <urn:b> .', 'application/n-triples')!;
    expect(() => resolveArgumentRef('alice', { resultRef: handle, columns: [{ from: 's', to: 's' }] })).toThrow(/not rows/);
  });

  it('reads another subject handle as gone', () => {
    const handle = cache.put('alice', srj, 'application/sparql-results+json')!;
    expect(() => resolveArgumentRef('mallory', { resultRef: handle, columns: [{ from: 'name', to: 'name' }] })).toThrow(ResultRefError);
  });
});

describe('resolveGraphRef', () => {
  it('returns a kept graph as inline content in its format', () => {
    const handle = cache.put('alice', '<urn:a> <urn:p> <urn:b> .', 'application/n-triples; charset=utf-8')!;
    expect(resolveGraphRef('alice', handle)).toEqual({
      dataGraphInline: '<urn:a> <urn:p> <urn:b> .',
      dataGraphInlineFormat: 'application/n-triples',
    });
  });

  it('refuses rows where a graph is expected', () => {
    const handle = cache.put('alice', srj, 'application/sparql-results+json')!;
    expect(() => resolveGraphRef('alice', handle)).toThrow(ValidationError);
  });
});

describe('resolveRequestRefs', () => {
  it('appends referenced arguments and maps referenced graphs', () => {
    const rows = cache.put('anonymous', srj, 'application/sparql-results+json')!;
    const graph = cache.put('anonymous', '<urn:a> <urn:p> <urn:b> .', 'text/turtle')!;
    const request = {} as FastifyRequest;
    const resolved = resolveRequestRefs(request, {
      arguments: [{ head: { vars: ['x'] }, results: { bindings: [] } } as never],
      argumentRefs: [{ resultRef: rows, columns: [{ from: 'name', to: 'name' }] }],
      dataGraphs: [{ resultRef: graph } as never, { dataGraphId: 'urn:dg:1' } as never],
    });
    expect(resolved.arguments).toHaveLength(2);
    expect(resolved.arguments?.[1]?.head.vars).toEqual(['name']);
    expect(resolved.dataGraphs).toEqual([
      { dataGraphInline: '<urn:a> <urn:p> <urn:b> .', dataGraphInlineFormat: 'text/turtle' },
      { dataGraphId: 'urn:dg:1' },
    ]);
  });
});
