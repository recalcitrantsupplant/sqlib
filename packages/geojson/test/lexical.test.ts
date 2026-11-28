import { describe, expect, it } from 'vitest';
import { toFeatureCollection } from '../src/index.js';

describe('lexicalVars', () => {
  it('keeps the lexical form of the columns it names', () => {
    const result = toFeatureCollection(
      {
        head: { vars: ['feature', 'price', 'zone'] },
        results: {
          bindings: [
            {
              feature: { type: 'uri', value: 'https://example.org/a' },
              price: { type: 'literal', value: '1.50', datatype: 'http://www.w3.org/2001/XMLSchema#decimal' },
              zone: { type: 'literal', value: '1', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
            },
          ],
        },
      },
      { idVar: 'feature', noGeometry: true, lexicalVars: ['price'] },
    );
    expect(result.ok && result.collection.features[0]?.properties).toEqual({ price: '1.50', zone: 1 });
  });
});
