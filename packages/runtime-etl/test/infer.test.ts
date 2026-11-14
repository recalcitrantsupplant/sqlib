import { describe, expect, it } from 'vitest';
import { valuesLookLikeIris } from '../src/index.js';

describe('valuesLookLikeIris', () => {
  it('accepts http, https and urn values, and ignores nulls', () => {
    expect(valuesLookLikeIris(['https://example.org/a', 'http://example.org/b', null, 'urn:x:1'])).toBe(true);
  });

  it('accepts a scheme in any case', () => {
    expect(valuesLookLikeIris(['HTTPS://example.org/a'])).toBe(true);
  });

  it('rejects a column with one value that is not an IRI', () => {
    expect(valuesLookLikeIris(['https://example.org/a', 'As'])).toBe(false);
  });

  it('rejects text with a colon that is not a listed scheme', () => {
    expect(valuesLookLikeIris(['Note: x', 'Note:y'])).toBe(false);
  });

  it('rejects a value with whitespace', () => {
    expect(valuesLookLikeIris(['https://example.org/a b'])).toBe(false);
  });

  it('rejects numbers and a column of nulls only', () => {
    expect(valuesLookLikeIris([1, 2])).toBe(false);
    expect(valuesLookLikeIris([null, undefined])).toBe(false);
    expect(valuesLookLikeIris([])).toBe(false);
  });
});
