# The `sqlib` command line

`sqlib` runs SPARQL queries, ETL jobs and SHACL 1.2 rule sets in one process,
with no sqlib server. It is for pipelines, for example a container that reads
rows, converts them to RDF, infers over them and writes the result, with no
HTTP between the steps.

It runs the same code as the server:

- The parser of the server compiles a query, and the splice of the export
  runtime applies its arguments.
- An ETL job goes through the ETL loop of the server.
- A rule set goes through the rule runner of the server.

Two tests check this: `packages/api/test/lib/etlParity.test.ts` and
`packages/api/test/lib/srlParity.test.ts`. The plan is in
[cli-and-in-process-runs.md](../proposals/cli-and-in-process-runs.md).

## Running it

Status:

- Done: the packages are ready to publish, and pass the same install checks as
  the static-export runtime.
- To do: publish them to npm. After that, `npm install -g
  @sparql-query-lib/cli` installs the command.

To run it now, use one of these:

- **From this repository.** `pnpm install && pnpm build`, then
  `node packages/cli/dist/cli.js <command>`.
- **In a container.** Build `examples/docker/cli-minimal` from the repository
  root. See [Container images](#container-images) below.

It needs Node 22.4 or later. The native binding of DuckDB is installed with it.

## Commands

Each command reads `-` as standard input. It writes to standard output, unless
`--out` names a file. Logs and progress go to standard error, so you can pipe
the output of one command into the next. Each command takes `--help`.

### `sqlib query`

```sh
sqlib query --file by-city.rq --data people.ttl --arg 'city=<http://ex/Perth>' --limit 1=20
```

Runs a query from a file. Parameters work as on the server: a
`VALUES ?x { UNDEF }` clause is a slot, and `LIMIT 0001` is a named limit.

- `--arg var=term` adds one row to a slot with one variable. Repeat it for more
  rows. Write a term as in SPARQL: `<http://…>`, `"text"`, `"text"@en`,
  `"1"^^<datatype>`, or a bare number or boolean.
- `--args file.json` takes argument sets as SPARQL Results JSON, for a slot
  that binds several variables. The format is the same as for `POST /execute`.
- `--limit name=n` and `--offset name=n` fill `LIMIT 000n` and `OFFSET 000n`.
- `--endpoint url` runs against a SPARQL endpoint. Without it, the command
  loads the `--data` files into an Oxigraph store in the process. The format
  comes from the file name, or from `--data-format`.
- `--text` prints the query with the arguments applied, and does not run it.

SELECT and ASK print SPARQL Results JSON. CONSTRUCT and DESCRIBE print RDF, in
`--format` (Turtle by default).

### `sqlib etl run`

```sh
sqlib etl run --job job.json --out customers.nt
```

Runs an ETL job:

1. The SQL runs in DuckDB.
2. The command reads its rows in chunks.
3. Each chunk fills the `VALUES` slot of the CONSTRUCT template.
4. The command writes the RDF of each chunk as soon as it exists.

A run holds the RDF of one chunk at a time, for a source of any size.

The job file is JSON, in the shape of a stored ETL job:

```json
{
  "sql": "SELECT * FROM read_csv('customers.csv')",
  "templateFile": "construct.rq",
  "chunkSize": 1000,
  "columns": [
    { "columnName": "id", "targetVariable": "c", "termType": "uri",
      "iriTemplate": "http://ex/c/{value}", "nullPolicy": "skipRow" },
    { "columnName": "name", "targetVariable": "name", "termType": "literal",
      "nullPolicy": "undef" }
  ]
}
```

- Give `sql` or `sqlFile`, and `template` or `templateFile`. File names in the
  job are relative to the job file. DuckDB reads the paths in the SQL, so they
  are relative to the directory where `sqlib` runs.
- The template is a CONSTRUCT with exactly one `VALUES (…) { (UNDEF …) }` slot.
  The slot declares the `targetVariable` of each column.
- `--format` is `n-triples` (default), `n-quads` or `turtle`. The command writes
  each chunk as it arrives. In all three formats, chunks can be concatenated
  safely: Oxigraph writes no prefix declarations, and gives each blank node a
  random label.
- `--chunk-size`, `--max-rows` and `--dry-run` work as on the server.
- `--endpoint url` runs the CONSTRUCT on an endpoint, outside the process. The
  template reads only its own `VALUES` rows, so it seldom needs an endpoint.

**DuckDB access.** The server keeps each capability off by default, because
submitted SQL can reach the host of the server. The CLI runs in your own
process, and its purpose is to read local files. Its defaults are therefore:

| Flag | Default | Grants |
| --- | --- | --- |
| `--allow-filesystem` / `--no-allow-filesystem` | on | local file reads and writes |
| `--allow-http` | off | http(s) reads; implies filesystem, as in the server |
| `--allow-extension-install` | off | extension installation by DuckDB |
| `--unrestricted` | off | no sandbox at all |
| `--memory-limit` | `1GB` | the DuckDB `memory_limit`; empty for none |
| `--query-timeout` | `300000` | milliseconds for each chunk; `0` for none |

At the start of each run, the command prints the resolved profile to standard
error. An extension that is already installed loads under the default profile.
For example, start the SQL with `LOAD azure;`. The [ETL guide](etl.md) states
what each setting enforces.

### `sqlib rules run`

```sh
sqlib rules run --srl rules.srl --data base.ttl --out inferred.nt
```

Runs an SRL document. Its DATA blocks run once. Then each stratum of rules runs
to its own fixpoint. The `--data` files are the base graph. The output is the
inference graph: the triples that the rules and DATA blocks added.

- The stratifier of `srl` puts the rules in strata. The command refuses a
  document that does not stratify, and names the cycle.
- `--max-iterations` is the number of passes for each stratum (default 100).
- `--format` is `n-triples` (default), `n-quads` or `json-ld`.
- `--trace` prints the effect of each rule on each pass to standard error.
- `--tuples` gives initial named-tuple rows.

Exit status 0 means that the run converged. Status 2 means that a stratum
reached `--max-iterations`, or that the rules cycle. The output is then the
graph at that point.

### `sqlib pull` and `--bundle`

```sh
SQLIB_TOKEN=… sqlib pull --from https://sqlib.example.org/api \
  --library urn:sqlib:library:main --out lib.json
sqlib check lib.json
sqlib etl run --bundle lib.json --job customers --out customers.nt
sqlib rules run --bundle lib.json --rule-set ancestors --data customers.nt
```

`sqlib pull` fetches the [export bundle](static-export.md) of a library from a
running server, and writes it to a file. **Export…** on the main page of the
web app downloads the same file. A run from that file needs no server. The
bundle holds the queries, ETL jobs and rule sets of the library:

- **A query** is compiled, as for the static runtime.
- **An ETL job** has its SQL, its column mapping, its chunk size and its
  compiled CONSTRUCT template. The bundle does not hold its backend. The place
  where the job runs decides the source of the SQL and the destination of the
  RDF.
- **A rule set** has the SRL document that the server exports for it, with
  DATA blocks, and its initial tuple rows.

`--bundle <file>` with `--query`, `--job` or `--rule-set <key>` runs one entry.
`sqlib check lib.json` validates a bundle, checks its hashes and lists the
keys. A bundle that a person edited fails its hash check, and is refused.

`pull` options:

- `--tag iri[,iri]` and `--match any|all` export a subset, as the export route
  does. ETL jobs have no tags, so a tag filter omits all of them.
- `--no-queries`, `--no-groups`, `--no-etl` and `--no-rule-sets` omit those
  members. A query group still holds the queries that it runs. The command
  refuses to turn off all four, before it calls the server.
- A bearer token comes from the environment variable `SQLIB_TOKEN`, or from the
  variable that `--token-env` names. It is never an argument, because arguments
  go into shell history and process lists.

The command reports each entry that the server could not export on standard
error, one line for each entry, with the reason. Examples are a job whose
template is not a CONSTRUCT, and a rule set with a data block that has no
`DATA` form.

### Run reports

`etl run` and `rules run` take `--report <file>`. After the run, the file holds
a JSON record of the run. The server does not see such a run, so it keeps no
execution record. The report has:

- what ran: the bundle and key, or the file; the hashes of the template and the
  SQL; and the job, version and mapping IRIs of the server;
- for a job: the DuckDB profile and limits, the chunk size, rows and chunks;
- for a rule set: passes and triples inferred;
- the path, format, size and SHA-256 of the output;
- start and end times, and milliseconds for each stage (`duckdbInit`,
  `extract`, `construct` and `write` for a job; `run` and `write` for a rule
  set);
- the end state: `ok`, `dry-run`, `converged`, `maxIterations`, `cycle` or
  `failed` with the error.

A failed run also writes its report. `--report -` writes the report to standard
output. `--out` must then name a file.

### `sqlib check`

```sh
sqlib check queries/*.rq rules/*.srl
```

Parses each file, and reports what sqlib would refuse. It runs nothing. It
reports:

- for a query: its form, its parameters, and whether it compiles to a template;
- for SRL: whether it parses, is well formed and stratifies;
- for a bundle (`.json`): its shape, its hashes, whether its rule sets compile,
  and its keys.

The exit status is 1 if any file has a problem, so you can use it in a CI step.

## Pipelines

You can join commands with files and pipes. This example converts rows to RDF,
then infers:

```sh
sqlib etl run --job customers.json \
  | sqlib rules run --srl customers.srl --data - --data-format nt --out inferred.nt
```

## Container images

`examples/docker/` has three examples. None of them is the published image.

- **`cli-minimal`** builds the CLI from this repository on
  `node:26-bookworm-slim`. CI builds it, and runs each command in it on the
  files in `sample/`.
- **`cli-duckdb-azure`** adds the DuckDB extensions `httpfs` and `azure` at
  build time. A job can then read `az://` paths, and the sandbox never needs to
  allow a download. Run jobs with `--allow-http`, and `LOAD azure;` in the SQL.
- **`cli-azcopy`** adds `azcopy`, and a script that copies rows in, runs the job
  and copies the RDF out. DuckDB never reads the blob store.

The two Azure examples need a storage account, so CI builds neither.

## What it does not do yet

- Run a query group. To get the same result, pipe one command into the next.
  See [Pipelines](#pipelines).
- Send a run report to a service. Collect the files that `--report` writes.
- Merge chunks into one Turtle document with prefixes. Each chunk is valid
  alone, and the chunks can be concatenated. The result has no prefix
  declarations.
