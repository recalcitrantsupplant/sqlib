# @sparql-query-lib/cli

The `sqlib` command line: run SPARQL queries, ETL jobs and SHACL 1.2 rule sets
in one process, with no sqlib server.

```sh
sqlib query --file by-city.rq --data people.ttl --arg 'city=<http://ex/Perth>'
sqlib etl run --job job.json --out customers.nt
sqlib rules run --srl rules.srl --data base.ttl --out inferred.nt
sqlib check queries/*.rq rules/*.srl
```

See [`docs/guides/cli.md`](../../docs/guides/cli.md) for every command and
option, the job file format, the DuckDB defaults and the example images.

The commands contain little code of their own. They use the same packages as
the server:

- `@sparql-query-lib/compiler` compiles queries;
- `@sparql-query-lib/runtime` applies arguments;
- `@sparql-query-lib/runtime-etl` runs the ETL loop;
- `@sparql-query-lib/runtime-srl` runs rules;
- `@sparql-query-lib/runtime-duckdb` is the sandboxed DuckDB.

## Status

To do: publish to npm. Until then, the package is private to the workspace.
