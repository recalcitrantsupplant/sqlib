import { describe, expect, it } from 'vitest';
import { QueryTypeIri } from '@sparql-query-lib/types';
import { templateRefusal } from '@/lib/etlTemplateQuery';

describe('templateRefusal', () => {
  it('accepts a CONSTRUCT with a multi-variable UNDEF slot', () => {
    const text = 'CONSTRUCT { ?s ?p ?o } WHERE { VALUES (?s ?p ?o) { (UNDEF UNDEF UNDEF) } }';
    expect(templateRefusal(text, 'CONSTRUCT')).toBeNull();
  });

  it('accepts a single-variable slot and a lower-case query type', () => {
    expect(templateRefusal('CONSTRUCT { ?s a ?t } WHERE { VALUES ?s { UNDEF } }', 'construct')).toBeNull();
  });

  it('accepts the query type IRI that the API stores', () => {
    expect(templateRefusal('CONSTRUCT { ?s a ?t } WHERE { VALUES ?s { UNDEF } }', QueryTypeIri.construct)).toBeNull();
  });

  it('refuses a SELECT', () => {
    expect(templateRefusal('SELECT * WHERE { VALUES ?s { UNDEF } }', 'SELECT')).toMatch(/CONSTRUCT/);
  });

  it('reads the form from the text when the version has no query type', () => {
    expect(templateRefusal('CONSTRUCT { ?s ?p ?o } WHERE { VALUES ?s { UNDEF } }', null)).toBeNull();
    expect(templateRefusal('ASK { ?s ?p ?o }', null)).toMatch(/CONSTRUCT/);
  });

  it('refuses a CONSTRUCT whose VALUES clause holds data', () => {
    const text = 'CONSTRUCT { ?s ?p ?o } WHERE { VALUES ?s { <http://example.org/a> } ?s ?p ?o }';
    expect(templateRefusal(text, 'CONSTRUCT')).toMatch(/parameter slot/);
  });
});
