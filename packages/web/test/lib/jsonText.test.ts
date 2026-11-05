import { describe, it, expect } from 'vitest';
import { compactJson, expandJson, parseJson } from '@/lib/jsonText';
import { inferTerm, termTypeLabel } from '@/lib/argumentTerms';
import { RDF_JSON } from '@/types/argument-sets';

const CQL =
  '{"op":"and","args":[{"op":"in","args":[{"property":"urn:jena:lucene:field#entityType"},["https://schema.org/Report","http://www.w3.org/ns/sosa/Sample"]]},{"op":"in","args":[{"property":"urn:jena:lucene:field#sourceSystem"},["https://linked.data.gov.au/dataset/gswa/sourcesystem/WAPIMS"]]}]}';

describe('jsonText', () => {
  it('expands and compacts back to the same text', () => {
    const expanded = expandJson(CQL);
    expect(expanded.split('\n').length).toBeGreaterThan(10);
    expect(expanded).toContain('\n  "op": "and",\n');
    expect(JSON.parse(expanded)).toEqual(JSON.parse(CQL));
    expect(compactJson(expanded)).toBe(CQL);
  });

  it('keeps tokens exactly as typed', () => {
    const text = '{ "n": 1.0, "e": "caf\\u00e9", "s": "a , b : { [" }';
    expect(compactJson(text)).toBe('{"n":1.0,"e":"caf\\u00e9","s":"a , b : { ["}');
    expect(expandJson(text)).toBe('{\n  "n": 1.0,\n  "e": "caf\\u00e9",\n  "s": "a , b : { ["\n}');
  });

  it('keeps empty objects and arrays on one line', () => {
    expect(expandJson('{"a":{},"b":[]}')).toBe('{\n  "a": {},\n  "b": []\n}');
  });

  it('reports a parse error', () => {
    expect(parseJson('{"a":').ok).toBe(false);
    expect(parseJson(CQL).ok).toBe(true);
  });
});

describe('rdf:JSON terms', () => {
  it('infers rdf:JSON for an object or array, not for a bare scalar', () => {
    expect(inferTerm(CQL)).toEqual({ type: 'literal', value: CQL, datatype: RDF_JSON });
    expect(inferTerm('[1,2]').datatype).toBe(RDF_JSON);
    expect(inferTerm('"x"').datatype).toBeUndefined();
    expect(inferTerm('{not json').datatype).toBeUndefined();
  });

  it('labels the cell rdf:JSON', () => {
    expect(termTypeLabel({ type: 'literal', value: '{}', datatype: RDF_JSON })).toBe('rdf:JSON');
  });
});
