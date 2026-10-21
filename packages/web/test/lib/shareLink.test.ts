import { describe, it, expect } from 'vitest';
import {
  decodeSharePayload,
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
    const bytes = new TextEncoder().encode(JSON.stringify({ body: 42 }));
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    const data = `v1.${btoa(String.fromCharCode(...compressed)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    await expect(decodeSharePayload(data)).rejects.toThrow('damaged');
  });

  it('refuses a payload that inflates past the bound', async () => {
    const data = await encodeSharePayload({ body: 'a'.repeat(2_000_000) });
    await expect(decodeSharePayload(data)).rejects.toThrow('too large');
  });
});
