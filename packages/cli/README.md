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

The commands are thin. Compiling is `@sparql-query-lib/compiler`, the query
splice is `@sparql-query-lib/runtime`, the ETL loop is
`@sparql-query-lib/runtime-etl`, the rule runner is `@sparql-query-lib/runtime-srl`,
and the sandboxed DuckDB is `@sparql-query-lib/runtime-duckdb`: the code the
server runs.

## Status

Private to the workspace until its packages are published.
