import { describe, it, expect } from 'vitest';
import {
  argumentSetBodyFromShare,
  decodeSharePayload,
  isEmptySharePayload,
  shareRoute,
  encodeSharePayload,
  MAX_SHARE_DATA_LENGTH,
  shareDataFromHash,
  shareHash,
  ShareLinkError,
} from '@/lib/shareLink';

const QUERY = `PREFIX schema: <https://schema.org/>
SELECT ?city ?name WHERE {
  VALUES ?city { UNDEF }
  ?city a schema:City ; schema:name ?name .
  FILTER(lang(?name) = "en")
} LIMIT 0001`;

/** A payload encoded as-is, without `encodeSharePayload`'s tidying, to test the reader. */
async function rawData(json: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return `v1.${btoa(String.fromCharCode(...compressed)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

describe('shareLink', () => {
  it('round-trips a body and a name', async () => {
    const data = await encodeSharePayload({ body: QUERY, name: 'Cities “en”' });
    expect(data.startsWith('v1.')).toBe(true);
    expect(data).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    await expect(decodeSharePayload(data)).resolves.toEqual({ body: QUERY, name: 'Cities “en”' });
  });

  it('leaves an empty name out', async () => {
    const data = await encodeSharePayload({ body: 'ASK {}', name: '  ' });
    await expect(decodeSharePayload(data)).resolves.toEqual({ body: 'ASK {}' });
  });

  it('compresses a repetitive query well under the limit', async () => {
    const body = Array.from({ length: 60 }, (_, i) => `  ?s <http://example.org/vocab#property${i}> ?o${i} .`).join('\n');
    const data = await encodeSharePayload({ body: `SELECT * WHERE {\n${body}\n}` });
    expect(data.length).toBeLessThan(body.length / 2);
    expect(data.length).toBeLessThan(MAX_SHARE_DATA_LENGTH);
  });

  it('reads the data out of a fragment and back', async () => {
    const data = await encodeSharePayload({ body: QUERY });
    expect(shareDataFromHash(shareHash(data))).toBe(data);
    expect(shareDataFromHash('')).toBeNull();
    expect(shareDataFromHash('#results')).toBeNull();
  });

  it('refuses an unknown version', async () => {
    await expect(decodeSharePayload('v9.abc')).rejects.toBeInstanceOf(ShareLinkError);
    await expect(decodeSharePayload('nodot')).rejects.toBeInstanceOf(ShareLinkError);
  });

  it('refuses a damaged link', async () => {
    const data = await encodeSharePayload({ body: QUERY });
    await expect(decodeSharePayload(data.slice(0, data.length - 10))).rejects.toBeInstanceOf(ShareLinkError);
    await expect(decodeSharePayload('v1.not+base64!')).rejects.toBeInstanceOf(ShareLinkError);
  });

  it('refuses a payload without a string body', async () => {
    await expect(decodeSharePayload(await rawData({ body: 42 }))).rejects.toThrow('damaged');
  });

  it('refuses a payload that carries nothing', async () => {
    await expect(decodeSharePayload(await rawData({}))).rejects.toThrow('damaged');
    await expect(decodeSharePayload(await rawData({ name: 'only a name' }))).rejects.toThrow('damaged');
  });

  it('round-trips arguments, limits, offsets and an endpoint without a body', async () => {
    const payload = {
      arguments: [{
        head: { vars: ['city'] },
        results: { bindings: [
          { city: { type: 'uri' as const, value: 'http://example.org/Perth' } },
          { city: { type: 'literal' as const, value: 'Hobart', 'xml:lang': 'en' } },
        ] },
      }],
      limits: [{ name: '1', value: 20 }],
      offsets: [{ name: '2', value: 40 }],
      endpoint: 'https://dbpedia.org/sparql',
    };
    await expect(decodeSharePayload(await encodeSharePayload(payload))).resolves.toEqual(payload);
  });

  it('refuses an endpoint that is not http or https', async () => {
    await expect(decodeSharePayload(await rawData({ endpoint: 'javascript:alert(1)' }))).rejects.toThrow('damaged');
    await expect(decodeSharePayload(await rawData({ endpoint: 'not a url' }))).rejects.toThrow('damaged');
  });

  it('refuses malformed argument terms and parameters', async () => {
    const bad = { head: { vars: ['x'] }, results: { bindings: [{ x: { type: 'bnode', value: 'b0' } }] } };
    await expect(decodeSharePayload(await rawData({ arguments: [bad] }))).rejects.toThrow('damaged');
    await expect(decodeSharePayload(await rawData({ limits: [{ name: '1', value: -1 }] }))).rejects.toThrow('damaged');
  });

  it('drops cells for variables a slot does not declare', async () => {
    const argument = { head: { vars: ['x'] }, results: { bindings: [{ x: { type: 'literal', value: 'a' }, y: { type: 'literal', value: 'b' } }] } };
    const payload = await decodeSharePayload(await rawData({ arguments: [argument] }));
    expect(payload.arguments![0]!.results.bindings).toEqual([{ x: { type: 'literal', value: 'a' } }]);
  });

  it('refuses a payload that inflates past the bound', async () => {
    const data = await encodeSharePayload({ body: 'a'.repeat(2_000_000) });
    await expect(decodeSharePayload(data)).rejects.toThrow('too large');
  });
});

describe('argumentSetBodyFromShare', () => {
  it('builds tuple and scalar bindings from shared values', () => {
    const body = argumentSetBodyFromShare({
      arguments: [{ head: { vars: ['a', 'b'] }, results: { bindings: [{ a: { type: 'literal', value: '1' } }] } }],
      limits: [{ name: '1', value: 5 }],
      offsets: [{ name: '2', value: 10 }],
    });
    expect(body).toEqual({
      tupleBindings: [{
        tupleSignature: 'a|b',
        variables: ['a', 'b'],
        rows: [{ position: 0, values: { a: { type: 'literal', value: '1' } } }],
      }],
      scalarBindings: [
        { parameterKind: 'limit', parameterName: '1', numericValue: 5 },
        { parameterKind: 'offset', parameterName: '2', numericValue: 10 },
      ],
    });
  });

  it('is null when nothing is shared', () => {
    expect(argumentSetBodyFromShare({ body: 'ASK {}' })).toBeNull();
  });
});

describe('shareRoute', () => {
  it('puts references in the query string', () => {
    expect(shareRoute({
      recordId: 'urn:sqlib:query:1',
      version: 3,
      argumentSetId: 'urn:sqlib:argument-set:2',
      backendId: 'urn:sqlib:backend:3',
      payload: {},
    })).toEqual({
      path: '/queries/urn%3Asqlib%3Aquery%3A1',
      query: { version: '3', argumentSet: 'urn:sqlib:argument-set:2', backend: 'urn:sqlib:backend:3' },
    });
  });

  it('opens the section when there is no saved record, and drops a version with it', () => {
    expect(shareRoute({ recordId: null, version: 3, argumentSetId: null, backendId: null, payload: { body: 'x' } }))
      .toEqual({ path: '/queries', query: {} });
  });

  it('knows an empty payload', () => {
    expect(isEmptySharePayload({})).toBe(true);
    expect(isEmptySharePayload({ name: 'n' })).toBe(true);
    expect(isEmptySharePayload({ body: '' })).toBe(false);
  });
});
