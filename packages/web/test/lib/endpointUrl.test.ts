/**
 * What counts as an endpoint URL, and what an unnamed one is called.
 *
 * The scheme check is the whole point of the first: `localhost:7878/sparql`
 * parses as a URL whose *scheme* is `localhost`, so "did it parse" is not the
 * question. The second exists because a pasted endpoint has no name and must
 * not have to invent one.
 */
import { describe, it, expect } from 'vitest';
import { endpointDisplayName, validateEndpoint } from '@/lib/endpointUrl';

describe('validateEndpoint', () => {
  it('accepts http and https', () => {
    expect(validateEndpoint('https://query.wikidata.org/sparql')).toBeNull();
    expect(validateEndpoint('http://localhost:7878/sparql')).toBeNull();
  });

  it('accepts a URL pasted with surrounding space', () => {
    expect(validateEndpoint('  https://query.wikidata.org/sparql  ')).toBeNull();
  });

  it('rejects a host and port with no scheme, which parses as one', () => {
    expect(validateEndpoint('localhost:7878/sparql')).toMatch(/scheme/);
  });

  it('rejects a scheme that is not the web', () => {
    expect(validateEndpoint('ftp://example.org/sparql')).toMatch(/scheme/);
  });

  it('asks for a URL when there is none', () => {
    expect(validateEndpoint('   ')).toBe('An endpoint URL is required.');
  });
});

describe('endpointDisplayName', () => {
  it('drops the scheme, which every row in the list shares', () => {
    expect(endpointDisplayName('https://query.wikidata.org/sparql'))
      .toBe('query.wikidata.org/sparql');
  });

  it('keeps the path, which is what tells two endpoints on a host apart', () => {
    expect(endpointDisplayName('https://example.org/bib/sparql')).toBe('example.org/bib/sparql');
    expect(endpointDisplayName('https://example.org/auth/sparql')).toBe('example.org/auth/sparql');
  });

  it('drops a trailing slash', () => {
    expect(endpointDisplayName('http://localhost:7878/')).toBe('localhost:7878');
  });
});
