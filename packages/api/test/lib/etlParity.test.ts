/**
 * WP3's acceptance test: an ETL job gives the same RDF through the API's
 * pipeline and through the path the CLI will take.
 *
 * - The API path is `EtlService.runPipeline`: the API's parser applies the
 *   arguments, and the API's Oxigraph executor runs the CONSTRUCT.
 * - The CLI path compiles the template from text with
 *   `@sparql-query-lib/compiler`, and runs `runEtl` on the runtime's own
 *   Oxigraph executor.
 *
 * Both read the same DuckDB source. If they disagree on one job, the plan has
 * failed at its one promise (docs/proposals/cli-and-in-process-runs.md).
 */
import { describe, it, expect } from 'vitest';
import * as oxigraph from 'oxigraph';
import { compileQueryTemplate } from '@sparql-query-lib/compiler';
import { oxigraphExecutor } from '@sparql-query-lib/runtime-oxigraph';
import { runEtl, type ColumnDefinition } from '@sparql-query-lib/runtime-etl';
import { EtlService } from '../../src/lib/EtlService.js';
import { duckDbService } from '../../src/lib/DuckDbService.js';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';

let duckdbAvailable = true;
try {
  await import('@duckdb/node-api');
} catch {
  duckdbAvailable = false;
}

const XSD = 'http://www.w3.org/2001/XMLSchema#';

// Every mapping feature at once: an IRI column, a language tag, a datatype
// and a NULL left unbound. The SQL drops the NULL-id row and formats the
// timestamp, and the template builds an IRI that needs encoding. Three chunks
// of two, so chunking is exercised too.
const SQL = `SELECT id, name, score, strftime(joined, '%Y-%m-%dT%H:%M:%S') AS joined, tier FROM (VALUES
  (1, 'Ann Lee', 'en', 3.5, TIMESTAMP '2020-01-02 03:04:05', 'http://ex/tier/gold'),
  (2, 'Bo',      'en', NULL, TIMESTAMP '2021-05-06 07:08:09', NULL),
  (3, 'Cy',      'en', 1.25, NULL, 'http://ex/tier/silver'),
  (NULL, 'Gone', 'en', 9.0, NULL, 'http://ex/tier/none'),
  (5, 'Éva',     'en', 0.0, TIMESTAMP '2022-12-31 23:59:59', 'http://ex/tier/bronze'),
  (6, 'Di',      'en', 2.0, NULL, NULL)
) AS t(id, name, lang, score, joined, tier) WHERE id IS NOT NULL`;

const TEMPLATE = `PREFIX ex: <http://ex/>
CONSTRUCT {
  ?customer ex:name ?name ; ex:score ?score ; ex:joined ?joined ; ex:tier ?tier .
} WHERE {
  VALUES (?id ?name ?score ?joined ?tier) { (UNDEF UNDEF UNDEF UNDEF UNDEF) }
  BIND(IRI(CONCAT("http://ex/customer/", ENCODE_FOR_URI(?id))) AS ?customer)
}`;

const columns: ColumnDefinition[] = [
  { columnName: 'id', termType: 'literal' },
  { columnName: 'name', termType: 'literal', lang: 'en' },
  { columnName: 'score', termType: 'literal', datatypeIri: `${XSD}decimal` },
  { columnName: 'joined', termType: 'literal', datatypeIri: `${XSD}dateTime` },
  { columnName: 'tier', termType: 'uri' },
];

const lines = (chunks: string[]) =>
  chunks.join('\n').split('\n').map(line => line.trim()).filter(Boolean).sort();

describe.skipIf(!duckdbAvailable)('one ETL job, two hosts', () => {
  it('gives the same RDF through the API pipeline and through the CLI path', async () => {
    const viaApi: string[] = [];
    const apiResult = await new EtlService('urn:test:etl').runPipeline({
      sql: SQL,
      sparqlTemplate: TEMPLATE,
      columnDefs: columns,
      executor: new OxigraphSparqlExecutor(new oxigraph.Store()),
      chunkSize: 2,
      onOutput: async rdf => { viaApi.push(rdf); },
    });

    const viaCli: string[] = [];
    const cliResult = await runEtl({
      source: duckDbService.streamChunks(SQL, 2),
      query: compileQueryTemplate(TEMPLATE, { name: 'customers' }).template,
      columns,
      executor: await oxigraphExecutor({ rdfFormat: 'application/n-quads' }),
      onOutput: async rdf => { viaCli.push(rdf); },
    });

    expect(cliResult).toEqual(apiResult);
    expect(apiResult).toEqual({ totalRows: 5, completedChunks: 3 });

    const api = lines(viaApi);
    expect(api.length).toBeGreaterThan(0);
    expect(lines(viaCli)).toEqual(api);

    // What both agree on is right, not just equal: the dropped row is absent,
    // the NULL is unbound, and the timestamp the SQL formatted is a valid
    // xsd:dateTime.
    expect(api.join('\n')).not.toContain('Gone');
    expect(api).toContain(`<http://ex/customer/1> <http://ex/name> "Ann Lee"@en .`);
    expect(api).toContain(`<http://ex/customer/1> <http://ex/joined> "2020-01-02T03:04:05"^^<${XSD}dateTime> .`);
    expect(api.some(line => line.startsWith('<http://ex/customer/2> <http://ex/score>'))).toBe(false);
    expect(api).toContain('<http://ex/customer/1> <http://ex/tier> <http://ex/tier/gold> .');
  });
});
