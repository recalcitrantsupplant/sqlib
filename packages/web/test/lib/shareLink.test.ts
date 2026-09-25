import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeSharePayload,
  encodeSharePayload,
  savedShareUrl,
  scratchShareUrl,
  sharePayloadFromHash,
  type ScratchSharePayload,
} from '@/lib/shareLink';

const QUERY: ScratchSharePayload = {
  section: 'query',
  name: 'People by name',
  description: 'Every foaf:name — ünïcödé too',
  body: 'SELECT * WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?o } LIMIT 10',
  defaultBackend: 'urn:backend:1',
};

const RULE: ScratchSharePayload = {
  section: 'rule',
  name: 'Untitled rule set 2',
  description: null,
  body: { srl: 'RULE { ?s a :B } WHERE { ?s a :A }', tuplesEnabled: false, dataGraphVersionId: null },
  defaultBackend: null,
};

describe('share payload encoding', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([QUERY, RULE])('round-trips a $section', async (payload) => {
    const encoded = await encodeSharePayload(payload);
    expect(encoded.startsWith('z.')).toBe(true);
    expect(encoded).toMatch(/^[a-z]\.[A-Za-z0-9_-]+$/);
    expect(await decodeSharePayload(encoded)).toEqual(payload);
  });

  it('falls back to plain JSON where the browser cannot compress, and still reads it', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const encoded = await encodeSharePayload(QUERY);
    expect(encoded.startsWith('j.')).toBe(true);
    expect(await decodeSharePayload(encoded)).toEqual(QUERY);
  });

  it('compresses a long query to well under its own length', async () => {
    const body = Array.from({ length: 60 }, (_, i) => `  ?s <http://example.org/p${i}> ?o${i} .`).join('\n');
    const encoded = await encodeSharePayload({ ...QUERY, body: `SELECT * WHERE {\n${body}\n}` });
    expect(encoded.length).toBeLessThan(body.length / 2);
  });

  it.each([
    ['empty', ''],
    ['no format', 'abcdef'],
    ['unknown format', 'x.e30'],
    ['truncated', 'z.q1YqU7IqKM'],
    ['not JSON', `j.${btoa('nope')}`],
    ['wrong version', `j.${btoa(JSON.stringify({ v: 2, s: 'query', n: 'a', b: '' }))}`],
    ['unshareable section', `j.${btoa(JSON.stringify({ v: 1, s: 'group', n: 'a', b: {} }))}`],
    ['query with a non-string body', `j.${btoa(JSON.stringify({ v: 1, s: 'query', n: 'a', b: {} }))}`],
    ['rule with a string body', `j.${btoa(JSON.stringify({ v: 1, s: 'rule', n: 'a', b: 'x' }))}`],
  ])('returns null for a %s payload rather than throwing', async (_label, encoded) => {
    expect(await decodeSharePayload(encoded)).toBeNull();
  });
});

describe('share URLs', () => {
  const location = { origin: 'https://sqlib.test', pathname: '/', search: '?section=queries&query=urn%3Aq%3A1&version=3' };

  it('a saved entity shares its own address, without any fragment', () => {
    expect(savedShareUrl(location)).toBe('https://sqlib.test/?section=queries&query=urn%3Aq%3A1&version=3');
  });

  it('a scratch item shares the payload in the fragment and no scratch id', async () => {
    const url = await scratchShareUrl({ ...location, search: '?scratch=urn:ui-temp:abc' } as never, QUERY);
    const parsed = new URL(url);
    expect(parsed.search).toBe('');
    expect(url).not.toContain('urn:ui-temp');
    const encoded = sharePayloadFromHash(parsed.hash);
    expect(encoded).not.toBeNull();
    expect(await decodeSharePayload(encoded!)).toEqual(QUERY);
  });

  it('reads the payload only from its own fragment key', () => {
    expect(sharePayloadFromHash('')).toBeNull();
    expect(sharePayloadFromHash(undefined)).toBeNull();
    expect(sharePayloadFromHash('#section-2')).toBeNull();
    expect(sharePayloadFromHash('#share=z.abc')).toBe('z.abc');
  });
});
