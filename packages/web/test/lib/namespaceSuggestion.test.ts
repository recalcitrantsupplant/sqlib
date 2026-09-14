import { describe, expect, it } from 'vitest';
import { isValidPrefixName, splitIri, suggestPrefix } from '@/lib/namespaceSuggestion';
import { shrink } from '@/lib/curie';

describe('splitIri', () => {
  it('splits on the last hash', () => {
    expect(splitIri('http://www.w3.org/2000/01/rdf-schema#label')).toEqual({
      namespace: 'http://www.w3.org/2000/01/rdf-schema#',
      localName: 'label',
    });
  });

  it('splits on the last slash when there is no hash', () => {
    expect(splitIri('https://linked.data.gov.au/def/geoscience-commodities-wa/lead')).toEqual({
      namespace: 'https://linked.data.gov.au/def/geoscience-commodities-wa/',
      localName: 'lead',
    });
  });

  it('prefers a hash over an earlier slash', () => {
    expect(splitIri('http://example.com/vocab#a')?.namespace).toBe('http://example.com/vocab#');
  });

  it('declines an IRI with nothing after the delimiter', () => {
    expect(splitIri('https://linked.data.gov.au/def/')).toBeNull();
    expect(splitIri('http://example.com/vocab#')).toBeNull();
  });

  it('declines a bare authority, whose slashes are the scheme separator', () => {
    expect(splitIri('https://example.com')).toBeNull();
  });

  it('declines non-IRIs and literals', () => {
    expect(splitIri('gold')).toBeNull();
    expect(splitIri('92904')).toBeNull();
    expect(splitIri('')).toBeNull();
  });

  it('declines a local name that would not parse as a prefixed name', () => {
    // A space and a query string are both outside PN_LOCAL, so registering the
    // namespace would abbreviate nothing.
    expect(splitIri('http://example.com/vocab/two words')).toBeNull();
    expect(splitIri('http://example.com/search?q=1')).toBeNull();
  });

  it('agrees with shrink: whatever it splits, shrink can then abbreviate', () => {
    const iris = [
      'https://linked.data.gov.au/def/geoscience-commodities-wa/gold',
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
      'http://xmlns.com/foaf/0.1/knows',
      'https://linked.data.gov.au/dataset/gswa/sample/commodity/BASE-METALS',
    ];

    for (const iri of iris) {
      const split = splitIri(iri);
      expect(split, iri).not.toBeNull();
      const prefix = suggestPrefix(split!.namespace);
      const result = shrink(iri, [{ prefix, namespace: split!.namespace }]);
      expect(result?.curie, iri).toBe(`${prefix}:${split!.localName}`);
    }
  });
});

describe('suggestPrefix', () => {
  it('names a namespace after its last segment', () => {
    expect(suggestPrefix('http://xmlns.com/foaf/0.1/')).toBe('foaf');
    expect(suggestPrefix('https://linked.data.gov.au/def/gswa/')).toBe('gswa');
  });

  it('reduces a segment to the prefix grammar', () => {
    const suggestion = suggestPrefix('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
    expect(suggestion).toBe('rdf-syntax-ns');
    expect(isValidPrefixName(suggestion)).toBe(true);
  });

  it('caps a long segment at a word boundary', () => {
    const suggestion = suggestPrefix('https://linked.data.gov.au/def/geoscience-commodities-wa/');
    expect(suggestion).toBe('geoscience-commodities');
    expect(isValidPrefixName(suggestion)).toBe(true);
  });

  it('falls back to the host label when the segment carries no letters', () => {
    expect(suggestPrefix('https://linked.data.gov.au/2024/')).toBe('linked');
  });

  it('numbers a suggestion that is already taken', () => {
    expect(suggestPrefix('http://xmlns.com/foaf/0.1/', ['foaf'])).toBe('foaf2');
    expect(suggestPrefix('http://xmlns.com/foaf/0.1/', ['foaf', 'foaf2'])).toBe('foaf3');
  });

  it('always proposes something the prefix manager will accept', () => {
    const namespaces = [
      'http://example.com/1/',
      'urn:example:thing/',
      'https://example.com/-/',
      'https://example.com/%20/',
    ];
    for (const namespace of namespaces) {
      expect(isValidPrefixName(suggestPrefix(namespace)), namespace).toBe(true);
    }
  });
});
