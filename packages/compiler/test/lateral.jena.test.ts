import { beforeAll, describe, expect, it } from 'vitest';
import { SparqlQueryParser, type ApplyArgumentSet } from '../src/parser.js';

/**
 * LATERAL against a real Jena, with a Lucene text index.
 *
 * Jena's property functions read their argument list when they are called. A
 * sqlib query feeds those arguments from VALUES parameters, through a
 * BIND(COALESCE(…)) default. Without LATERAL, Jena may evaluate that part and
 * the property function apart and join them afterwards, so `text:query` runs
 * with unbound arguments ("Text query string is not a literal"). LATERAL makes
 * the order explicit.
 *
 * Skipped unless `SQLIB_TEST_JENA_URL` names the `text` dataset of a Fuseki
 * started with `fuseki-test/text/config.ttl`:
 *
 *   java -jar jena-fuseki-server-5.5.0.jar --port=3030 --config=fuseki-test/text/config.ttl
 *   SQLIB_TEST_JENA_URL=http://localhost:3030/text pnpm --filter @sparql-query-lib/compiler test
 */
const JENA = process.env.SQLIB_TEST_JENA_URL;

const PREFIXES = `PREFIX text: <http://jena.apache.org/text#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX ex: <http://example.org/>
`;

const DATA = `${PREFIXES}
INSERT DATA {
  ex:granite rdfs:label "granite" ; rdfs:comment "an igneous rock" .
  ex:basalt rdfs:label "basalt" ; rdfs:comment "a volcanic igneous rock" .
  ex:shale rdfs:label "shale" ; rdfs:comment "a sedimentary rock" .
}`;

/**
 * The search body: a text search on the chosen field, or an exact comment.
 * The UNION is what makes Jena evaluate the property function on its own.
 */
const SEARCH = `{ ?s text:query (?f1 ?q1) . } UNION { ?s rdfs:comment ?q1 . }`;

function searchQuery(lateral: boolean): string {
  return `${PREFIXES}
SELECT DISTINCT ?s WHERE {
  VALUES ?field { UNDEF }
  VALUES ?q { UNDEF }
  BIND(COALESCE(?field, rdfs:label) AS ?f1)
  BIND(COALESCE(?q, "granite") AS ?q1)
  ${lateral ? `LATERAL { ${SEARCH} }` : SEARCH}
}`;
}

const WITH_ARGUMENTS: ApplyArgumentSet[] = [
  {
    head: { vars: ['field'] },
    results: { bindings: [{ field: { type: 'uri', value: 'http://www.w3.org/2000/01/rdf-schema#comment' } }] },
  },
  { head: { vars: ['q'] }, results: { bindings: [{ q: { type: 'literal', value: 'volcanic' } }] } },
];

const WITH_NONE = [
  { head: { vars: ['field'] }, results: { bindings: [] }, whenEmpty: 'unconstrained' },
  { head: { vars: ['q'] }, results: { bindings: [] }, whenEmpty: 'unconstrained' },
] as unknown as ApplyArgumentSet[];

async function post(path: string, body: string, contentType: string, accept?: string): Promise<Response> {
  const response = await fetch(`${JENA}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...(accept ? { Accept: accept } : {}) },
    body,
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response;
}

async function subjects(queryText: string): Promise<string[]> {
  const response = await post('query', queryText, 'application/sparql-query', 'application/sparql-results+json');
  const json = (await response.json()) as { results: { bindings: Array<{ s?: { value: string } }> } };
  return json.results.bindings.map((row) => row.s?.value ?? '').sort();
}

describe.skipIf(!JENA)('LATERAL on Jena with a text index', () => {
  const parser = new SparqlQueryParser();

  beforeAll(async () => {
    await post('update', `${PREFIXES} DELETE WHERE { ?s ?p ?o }`, 'application/sparql-update');
    await post('update', DATA, 'application/sparql-update');
  });

  it('passes the caller\'s arguments to the property function', async () => {
    const text = parser.applyArguments(searchQuery(true), WITH_ARGUMENTS);
    expect(text).toContain('LATERAL');
    expect(await subjects(text)).toEqual(['http://example.org/basalt']);
  });

  it('passes the defaults to the property function when the caller sends none', async () => {
    const text = parser.applyArguments(searchQuery(true), WITH_NONE);
    expect(text).toContain('LATERAL');
    expect(text).not.toContain('VALUES');
    expect(await subjects(text)).toEqual(['http://example.org/granite']);
  });

  /*
   * The control. If Jena ever plans this query so that the arguments arrive,
   * the two tests above no longer show that LATERAL is what makes them arrive.
   */
  it('without LATERAL, the same query loses the arguments', async () => {
    const text = parser.applyArguments(searchQuery(false), WITH_ARGUMENTS);
    expect(await subjects(text)).toEqual([]);
  });
});
