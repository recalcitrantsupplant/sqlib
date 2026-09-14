import { describe, expect, it } from 'vitest';
import { describeTerm, prefixTableAbbreviator } from '../src/describe-term.js';

const PREFIXES: Array<readonly [string, string]> = [['ex', 'http://example.org/']];
const abbreviate = prefixTableAbbreviator(PREFIXES);

describe('describeTerm', () => {
  it('reports an absent binding as a state, not an empty string', () => {
    expect(describeTerm(undefined)).toMatchObject({ kind: 'absent', display: '—' });
    expect(describeTerm(null)).toMatchObject({ kind: 'absent' });
  });

  it('shows an IRI whole when nothing abbreviates it', () => {
    expect(describeTerm({ type: 'uri', value: 'http://other.org/a' }, { abbreviate })).toMatchObject({
      kind: 'uri',
      typeLabel: 'IRI',
      display: 'http://other.org/a',
      fullIri: null,
    });
  });

  it('abbreviates an IRI and keeps the full form for a tooltip', () => {
    expect(describeTerm({ type: 'uri', value: 'http://example.org/Perth' }, { abbreviate })).toMatchObject({
      display: 'ex:Perth',
      fullIri: 'http://example.org/Perth',
    });
  });

  it('leaves IRIs alone when the host supplies no abbreviator', () => {
    expect(describeTerm({ type: 'uri', value: 'http://example.org/Perth' })).toMatchObject({
      display: 'http://example.org/Perth',
      fullIri: null,
    });
  });

  it('still displays an IRI the serialiser would refuse to write', () => {
    // Display and substitution have different duties: one must never emit an
    // unsafe IRI, the other must never hide what the endpoint returned.
    expect(describeTerm({ type: 'uri', value: 'http://e/a> <http://e/b' }, { abbreviate })).toMatchObject({
      kind: 'uri',
      display: 'http://e/a> <http://e/b',
    });
  });

  it('describes a plain literal', () => {
    expect(describeTerm({ type: 'literal', value: 'Perth' })).toMatchObject({
      kind: 'literal',
      typeLabel: 'Literal',
      display: 'Perth',
      datatype: null,
      language: null,
    });
  });

  it('hides xsd:string, which every plain literal has and none of them mean', () => {
    expect(
      describeTerm({
        type: 'literal',
        value: 'Perth',
        datatype: 'http://www.w3.org/2001/XMLSchema#string',
      }).datatype,
    ).toBeNull();
  });

  it('shows a meaningful datatype, abbreviated', () => {
    expect(
      describeTerm({ type: 'literal', value: '42', datatype: 'http://example.org/int' }, { abbreviate })
        .datatype,
    ).toBe('ex:int');
  });

  it('shows a language tag and suppresses the implicit datatype beside it', () => {
    expect(
      describeTerm({
        type: 'literal',
        value: 'Perth',
        'xml:lang': 'en-AU',
        datatype: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString',
      }),
    ).toMatchObject({ language: 'en-AU', datatype: null });
  });

  it('describes a blank node', () => {
    expect(describeTerm({ type: 'bnode', value: 'b0' })).toMatchObject({
      kind: 'bnode',
      typeLabel: 'BNode',
      display: 'b0',
    });
  });

  it('passes an unrecognised type through rather than dropping the cell', () => {
    expect(describeTerm({ type: 'triple', value: '<<a b c>>' })).toMatchObject({
      kind: 'unknown',
      typeLabel: 'triple',
      display: '<<a b c>>',
    });
  });
});

describe('prefixTableAbbreviator', () => {
  it('reports whether it abbreviated', () => {
    expect(abbreviate('http://example.org/Perth')).toEqual({
      abbreviated: 'ex:Perth',
      wasAbbreviated: true,
      fullIri: 'http://example.org/Perth',
    });
    expect(abbreviate('http://other.org/a')).toEqual({
      abbreviated: 'http://other.org/a',
      wasAbbreviated: false,
    });
  });

  it('never throws on an IRI the serialiser rejects', () => {
    expect(abbreviate('http://e/a> <b')).toEqual({
      abbreviated: 'http://e/a> <b',
      wasAbbreviated: false,
    });
  });
});
