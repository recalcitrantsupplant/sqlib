/**
 * The ETL examples library's jobs run and give RDF.
 *
 * Each inline and file job runs for real through the API pipeline: DuckDB,
 * the column mapping and the template on an in-process Oxigraph store. The
 * HTTP jobs need the network, so they are checked for shape only.
 */
import { describe, it, expect } from 'vitest';
import * as oxigraph from 'oxigraph';
import { compileQueryTemplate } from '@sparql-query-lib/compiler';

// File reads are off by default; the file jobs need them. Set before the
// DuckDB service is first imported.
process.env.ETL_DUCKDB_ALLOW_FILESYSTEM = 'true';

const { ETL_DEMO_JOBS } = await import('../../src/lib/etlDemo/jobs.js');
const { EtlService } = await import('../../src/lib/EtlService.js');
const { OxigraphSparqlExecutor } = await import('../../src/server/OxigraphSparqlExecutor.js');

let duckdbAvailable = true;
try {
  await import('@duckdb/node-api');
} catch {
  duckdbAvailable = false;
}

/** The variables of the template's one all-UNDEF VALUES slot. */
function slotVariables(template: string): string[] {
  const match = /VALUES\s*\(([^)]*)\)\s*\{\s*\(\s*(?:UNDEF\s*)+\)\s*\}/i.exec(template);
  return match ? match[1].trim().split(/\s+/).map((name) => name.replace(/^\?/, '')) : [];
}

describe('ETL example jobs', () => {
  it('have unique names', () => {
    const names = ETL_DEMO_JOBS.map((job) => job.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(ETL_DEMO_JOBS.map((job) => [job.name, job] as const))(
    '%s: the mapping fills the template slot exactly, and the template compiles',
    (_name, job) => {
      const mapped = job.columns.map((column) => column.targetVariable).sort();
      expect(slotVariables(job.sparqlTemplate).sort()).toEqual(mapped);
      expect(() => compileQueryTemplate(job.sparqlTemplate, { name: job.name })).not.toThrow();
    },
  );

  const runnable = ETL_DEMO_JOBS.filter((job) => job.needs !== 'http');

  it.skipIf(!duckdbAvailable).each(runnable.map((job) => [job.name, job] as const))(
    '%s: runs and gives triples',
    async (_name, job) => {
      const output: string[] = [];
      const result = await new EtlService('urn:test:etl').runPipeline({
        sql: job.sql,
        sparqlTemplate: job.sparqlTemplate,
        columnDefs: job.columns,
        executor: new OxigraphSparqlExecutor(new oxigraph.Store()),
        chunkSize: 100,
        onOutput: async (rdf: string) => { output.push(rdf); },
      });
      expect(result.totalRows).toBeGreaterThan(0);
      expect(output.join('').trim().length).toBeGreaterThan(0);
    },
  );
});
