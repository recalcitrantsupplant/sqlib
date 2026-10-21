# @sparql-query-lib/runtime-etl

The sqlib ETL loop, with no server.

`runEtl` reads source rows a chunk at a time. It maps each row to a SPARQL
binding with a column mapping, splices the chunk into a CONSTRUCT as one
`VALUES` block, runs it on any runtime `Executor`, and hands the RDF to a sink.
It keeps no output of its own, so a run holds one chunk's RDF at a time.

```ts
import { compileQueryTemplate } from '@sparql-query-lib/compiler';
import { oxigraphExecutor } from '@sparql-query-lib/runtime-oxigraph';
import { runEtl } from '@sparql-query-lib/runtime-etl';

await runEtl({
  source: duckdb.streamChunks(sql, 5000),
  query: compileQueryTemplate(constructText, { name: 'customers' }).template,
  columns,
  executor: await oxigraphExecutor({ rdfFormat: 'application/n-triples' }),
  onOutput: async rdf => { await out.write(rdf); },
});
```

- **`source`** is any async iterable of `{ rows }`. The API and the CLI pass a
  `@sparql-query-lib/runtime-duckdb` stream; a test passes fixture rows.
- **`query`** is a compiled template, or a function that takes the chunk's
  argument set and returns query text. The API passes its parser's
  `applyArguments`, which uses the same compiled template whenever the query
  compiles.
- **`executor`** runs the CONSTRUCT. The template only reads its own `VALUES`
  rows, so an empty in-process store is a complete backend for it.
- **`maxRows`**, **`maxRowsPolicy`**, **`dryRun`** and **`signal`** stop a run
  as `POST /etl-jobs/:id/execute` does.

`rowsToBindings` and `toLexicalForm` are exported too: the tabular sink in the
API maps rows without running a CONSTRUCT.

## One job, two hosts

`packages/api/test/lib/etlParity.test.ts` runs one job through the API's
pipeline and through this package with a template compiled from text, and
requires the same RDF from both.

## Status

Private to the workspace. It becomes publishable with the command-line tool.
