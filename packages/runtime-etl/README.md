# @sparql-query-lib/runtime-etl

The sqlib ETL loop, with no server.

`runEtl` does these steps for each chunk of source rows:

1. It maps each row to a SPARQL binding, with a column mapping.
2. It puts the chunk into a CONSTRUCT as one `VALUES` block.
3. It runs the CONSTRUCT on a runtime `Executor`.
4. It gives the RDF to a sink.

It keeps no output, so a run holds the RDF of one chunk at a time.

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

The package also exports `rowsToBindings` and `toLexicalForm`. The tabular sink
in the API uses them to map rows with no CONSTRUCT.

## One job, two hosts

`packages/api/test/lib/etlParity.test.ts` runs one job through the API's
pipeline and through this package with a template compiled from text, and
requires the same RDF from both.

## Status

To do: publish to npm, with the command-line tool. Until then, the package is
private to the workspace.
