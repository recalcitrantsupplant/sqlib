# The `sqlib` command line

`sqlib` runs SPARQL queries, ETL jobs and SHACL 1.2 rule sets in one process,
with no sqlib server. It is built for pipelines: a container that reads rows,
converts them to RDF, infers over them and writes the result, with no HTTP
between the steps.

It runs the same code the server runs. A query is compiled by the server's
parser and applied by the export runtime's splice; an ETL job goes through the
server's ETL loop; a rule set goes through the server's rule runner. Two tests
hold that true: `packages/api/test/lib/etlParity.test.ts` and
`packages/api/test/lib/srlParity.test.ts`. The plan behind it is
[cli-and-in-process-runs.md](../proposals/cli-and-in-process-runs.md).

## Running it

The packages are not on npm yet. They are ready to publish, and pass the same
install checks as the static-export runtime; once they are, `npm install -g
@sparql-query-lib/cli` installs the command. Two ways to run it today:

- **From this repository.** `pnpm install && pnpm build`, then
  `node packages/cli/dist/cli.js <command>`.
- **In a container.** Build `examples/docker/cli-minimal` from the repository
  root; see [Container images](#container-images) below.

It needs Node 22.4 or later. DuckDB's native binding is installed with it.

## Commands

Every command reads `-` as standard input and writes to standard output unless
`--out` names a file. Logs and progress go to standard error, so a command's
output can be piped into the next. Each command takes `--help`.

### `sqlib query`

```sh
sqlib query --file by-city.rq --data people.ttl --arg 'city=<http://ex/Perth>' --limit 1=20
```

Runs a query from a file. Parameters work as they do on the server: a
`VALUES ?x { UNDEF }` clause is a slot, `LIMIT 0001` is a named limit.

- `--arg var=term` adds one row to a one-variable slot; repeat it for more rows.
  A term is written as in SPARQL: `<http://…>`, `"text"`, `"text"@en`,
  `"1"^^<datatype>`, or a bare number or boolean.
- `--args file.json` takes argument sets as SPARQL Results JSON, for a slot
  that binds several variables. The format is the one `POST /execute` takes.
- `--limit name=n` and `--offset name=n` fill `LIMIT 000n` and `OFFSET 000n`.
- `--endpoint url` runs against a SPARQL endpoint. Otherwise `--data` files
  are loaded into an in-process Oxigraph store; the format comes from the file
  name, or from `--data-format`.
- `--text` prints the substituted query instead of running it.

SELECT and ASK print SPARQL Results JSON. CONSTRUCT and DESCRIBE print RDF, in
`--format` (Turtle by default).

### `sqlib etl run`

```sh
sqlib etl run --job job.json --out customers.nt
```

Runs an ETL job: the SQL runs in DuckDB, its rows are read in chunks, each chunk
fills the CONSTRUCT template's `VALUES` slot, and each chunk's RDF is written as
soon as it exists. A run holds one chunk's RDF at a time, whatever the source's
size.

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

- `sql` or `sqlFile`, and `template` or `templateFile`. File names in the job
  are relative to the job file. Paths inside the SQL are DuckDB's, so they are
  relative to the directory `sqlib` runs in.
- The template is a CONSTRUCT with exactly one `VALUES (…) { (UNDEF …) }` slot,
  which declares every column's `targetVariable`.
- `--format` is `n-triples` (default), `n-quads` or `turtle`. Each chunk is
  written as it comes, and chunks concatenate safely in all three: Oxigraph
  writes no prefix declarations and gives every blank node a random label.
- `--chunk-size`, `--max-rows` and `--dry-run` work as on the server.
- `--endpoint url` runs the CONSTRUCT on an endpoint instead of in process. The
  template reads only its own `VALUES` rows, so it rarely needs one.

**DuckDB access.** The server keeps every capability off by default, because
submitted SQL reaches the server's host. The CLI runs in your own process and
reading local files is its job, so:

| Flag | Default | Grants |
| --- | --- | --- |
| `--allow-filesystem` / `--no-allow-filesystem` | on | local file reads and writes |
| `--allow-http` | off | http(s) reads; implies filesystem, as in the server |
| `--allow-extension-install` | off | DuckDB installing extensions |
| `--unrestricted` | off | no sandbox at all |
| `--memory-limit` | `1GB` | DuckDB's `memory_limit`; empty for none |
| `--query-timeout` | `300000` | milliseconds per chunk; `0` for none |

The resolved profile is printed to standard error at the start of each run. An
extension already installed loads under the default profile: start the SQL with
`LOAD azure;`, for example. What each setting enforces is in the
[ETL guide](etl.md).

### `sqlib rules run`

```sh
sqlib rules run --srl rules.srl --data base.ttl --out inferred.nt
```

Runs an SRL document: its DATA blocks once, then each stratum of rules to its
own fixpoint. The `--data` files are the base graph; the output is the
inference graph, the triples the rules and DATA blocks added.

- Rules are layered with `srl`'s stratifier. A document that does not stratify
  is refused, naming the cycle.
- `--max-iterations` is passes per stratum (default 100). `--format` is
  `n-triples` (default), `n-quads` or `json-ld`. `--trace` prints each rule's
  effect per pass to standard error. `--tuples` gives initial named-tuple rows.

Exit status 0 means converged. Status 2 means a stratum hit `--max-iterations`
or the rules cycle; the output is then the graph so far.

### `sqlib pull` and `--bundle`

```sh
SQLIB_TOKEN=… sqlib pull --from https://sqlib.example.org/api \
  --library urn:sqlib:library:main --out lib.json
sqlib check lib.json
sqlib etl run --bundle lib.json --job customers --out customers.nt
sqlib rules run --bundle lib.json --rule-set ancestors --data customers.nt
```

`sqlib pull` fetches a library's [export bundle](static-export.md) from a
running server and writes it to a file. **Export…** on the web app's main page
downloads the same file. A run from that file then needs no
server. The bundle carries the library's queries, its ETL jobs and its rule
sets:

- **A query** is compiled, exactly as for the static runtime.
- **An ETL job** carries its SQL, its column mapping, its chunk size and its
  CONSTRUCT template, compiled. Its backend stays behind: where the SQL reads
  from and where the RDF goes are decided where the job runs.
- **A rule set** carries the SRL document the server exports for it, DATA
  blocks included, and its initial tuple rows.

`--bundle <file>` with `--query`, `--job` or `--rule-set <key>` runs one entry.
`sqlib check lib.json` validates a bundle, verifies its hashes and lists the
keys. A bundle someone edited by hand fails its hash check and is refused.

`pull` options:

- `--tag iri[,iri]` and `--match any|all` export a subset, as the export route
  does. ETL jobs carry no tags, so a tag filter leaves them all out.
- `--no-queries`, `--no-groups`, `--no-etl` and `--no-rule-sets` leave those
  members out. A query group still carries the queries it runs. Turning all
  four off is refused before the server is asked.
- A bearer token comes from the environment variable `SQLIB_TOKEN`, or the one
  `--token-env` names. It is never an argument, because arguments land in shell
  history and process lists.

What the server could not export is reported on standard error, one line for
each entry, with the reason: a job whose template is not a CONSTRUCT, say, or a
rule set with a data block that has no `DATA` form.

### Run reports

`etl run` and `rules run` take `--report <file>`. After the run, the file holds
a JSON record of it, because a run the server never saw leaves no execution
record behind:

- what ran: the bundle and key or the file, the template's and the SQL's
  hashes, and the server's job, version and mapping IRIs;
- for a job: the DuckDB profile and limits, the chunk size, rows and chunks;
- for a rule set: passes and triples inferred;
- the output's path, format, size and SHA-256;
- start and end times, and milliseconds for each stage (`duckdbInit`,
  `extract`, `construct` and `write` for a job; `run` and `write` for a rule
  set);
- how it ended: `ok`, `dry-run`, `converged`, `maxIterations`, `cycle` or
  `failed` with the error.

A failed run still writes its report. `--report -` writes it to standard
output, and then `--out` has to name a file.

### `sqlib check`

```sh
sqlib check queries/*.rq rules/*.srl
```

Parses each file and reports what sqlib would refuse, without running it. For a
query: its form, its parameters, and whether it compiles to a template. For SRL:
whether it parses, is well formed and stratifies. For a bundle (`.json`): its
shape, its hashes, whether its rule sets compile, and its keys. Exit status 1 if
any file has a problem, so it fits a CI step.

## Pipelines

Commands compose through files and pipes. Rows to RDF, then inference:

```sh
sqlib etl run --job customers.json \
  | sqlib rules run --srl customers.srl --data - --data-format nt --out inferred.nt
```

## Container images

`examples/docker/` holds three examples, none of them the published image:

- **`cli-minimal`** builds the CLI from this repository on
  `node:26-bookworm-slim`. CI builds it and runs each command in it on the
  files in `sample/`.
- **`cli-duckdb-azure`** adds DuckDB's `httpfs` and `azure` extensions at build
  time, so a job can read `az://` paths without the sandbox ever allowing a
  download. Run jobs with `--allow-http` and `LOAD azure;` in the SQL.
- **`cli-azcopy`** adds `azcopy` and a script that copies rows in, runs the
  job and copies the RDF out. DuckDB never sees the blob store.

The two Azure examples need a storage account, so CI builds neither.

## What it does not do yet

- Run a query group. Pipe one command into the next instead; see
  [Pipelines](#pipelines).
- Send a run report anywhere. Collect the files `--report` writes.
- Merge chunks into one Turtle document with prefixes. Each chunk is valid on
  its own and the chunks concatenate, but the result has no prefix declarations.
