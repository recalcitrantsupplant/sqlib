import { compileQueryTemplate } from '@sparql-query-lib/compiler';
import { oxigraphExecutor } from '@sparql-query-lib/runtime-oxigraph';
import { runEtl, type ColumnDefinition, type EtlOutputChunk } from '../src/index.js';

const TEMPLATE = `PREFIX ex: <http://ex/>
CONSTRUCT { ?customer ex:name ?name } WHERE { VALUES (?customer ?name) { (UNDEF UNDEF) } }`;

const columns: ColumnDefinition[] = [
  { columnName: 'id', targetVariable: 'customer', termType: 'uri', iriTemplate: 'http://ex/c/{value}', nullPolicy: 'skipRow' },
  { columnName: 'name', targetVariable: 'name', termType: 'literal', nullPolicy: 'undef' },
];

async function* chunks(...batches: Array<Array<Record<string, unknown>>>) {
  for (const rows of batches) yield { rows };
}

async function collect(overrides: Partial<Parameters<typeof runEtl>[0]> = {}) {
  const outputs: Array<{ rdf: string; chunk: EtlOutputChunk }> = [];
  const result = await runEtl({
    source: chunks([{ id: 1, name: 'Ann' }, { id: 2, name: 'Bo' }], [{ id: 3, name: 'Cy' }]),
    query: compileQueryTemplate(TEMPLATE, { name: 'customers' }).template,
    columns,
    executor: await oxigraphExecutor({ rdfFormat: 'application/n-triples' }),
    onOutput: async (rdf, chunk) => { outputs.push({ rdf, chunk }); },
    ...overrides,
  });
  return { result, outputs };
}

describe('runEtl', () => {
  it('runs each chunk through the compiled template on an in-process store', async () => {
    const { result, outputs } = await collect();

    expect(result).toEqual({ totalRows: 3, completedChunks: 2 });
    expect(outputs.map(o => o.chunk)).toEqual([
      { index: 0, contentType: 'application/n-triples' },
      { index: 1, contentType: 'application/n-triples' },
    ]);
    expect(outputs[0]!.rdf).toContain('<http://ex/c/1> <http://ex/name> "Ann" .');
    expect(outputs[0]!.rdf).toContain('<http://ex/c/2> <http://ex/name> "Bo" .');
    expect(outputs[1]!.rdf).toContain('<http://ex/c/3> <http://ex/name> "Cy" .');
  });

  it('runs no query for a chunk whose rows all drop', async () => {
    const executed: string[] = [];
    const { result, outputs } = await collect({
      source: chunks([{ id: null, name: 'gone' }]),
      executor: { execute: async ({ queryText }) => { executed.push(queryText); return { contentType: 'x', data: '' }; } },
    });
    expect(result).toEqual({ totalRows: 1, completedChunks: 1 });
    expect(executed).toEqual([]);
    expect(outputs).toEqual([]);
  });

  it('accepts a function in place of a template, for a host that applies arguments itself', async () => {
    const seen: unknown[] = [];
    await collect({ query: argumentSet => { seen.push(argumentSet.head.vars); return TEMPLATE.replace('(UNDEF UNDEF)', '(<http://ex/c/9> "Z")'); } });
    expect(seen).toEqual([['customer', 'name'], ['customer', 'name']]);
  });

  it('stops at the chunk boundary after maxRows, or fails under the fail policy', async () => {
    expect((await collect({ maxRows: 2 })).result).toEqual({ totalRows: 2, completedChunks: 1 });
    await expect(collect({ maxRows: 2, maxRowsPolicy: 'fail' })).rejects.toThrow('more than 2 rows');
  });

  it('stops after the first chunk on a dry run', async () => {
    expect((await collect({ dryRun: true })).result).toEqual({ totalRows: 2, completedChunks: 1 });
  });

  it('throws the abort reason before reading on', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stopped by caller'));
    await expect(collect({ signal: controller.signal })).rejects.toThrow('stopped by caller');
  });
});
