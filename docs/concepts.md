# Concepts

This page defines the vocabulary the rest of the documentation uses, and the
relationships between the things it names. Read it before the guides: several
words in sqlib, "tuple" above all, name more than one thing.

## Library

A **Library** is the container everything else belongs to. A query, a query
group, a rule set, a data graph, a tuple set, an argument set, a test, a
benchmark and an ETL job each belong to exactly one library. A library may name
a `defaultBackend` and a set of `allowedBackends`, which is what its own saved
queries may execute against. One server holds many libraries, and a library is
the unit you export, import and copy.

## Stable pointers and immutable versions

Almost every entity comes in two parts. A **stable pointer** — `Query`,
`RuleSet`, `DataGraph`, `TupleSet`, `ArgumentSet`, `Test`, `EtlJob`,
`BenchmarkExperiment` — carries the name, description, tags and a
`currentVersion` link, and its IRI never changes. An **immutable version** —
`QueryVersion`, `RuleSetVersion`, and so on — carries the content and a numeric
`version`, and is never modified in place once saved.

Execution always names a version, so a run is reproducible. Two ways of
referring to content follow: a **pin** is a version IRI and always means the same
content; a **float** is a parent IRI and means whatever that entity's current
version is at the time of the call.

## Query and QueryVersion

A **Query** is a stable, named pointer, optionally naming a `defaultBackend`. A
**QueryVersion** holds the SPARQL text (`queryString`), its query type, the
parameters detected in it, and the inputs and outputs inferred from it. A query
version is *callable*: it declares parameters, and you invoke it with
arguments.

## Parameters

Parameters are declared **in the query text itself**, not in metadata beside it.
There are two forms.

**A table parameter is a `VALUES` clause whose only row is all `UNDEF`.**

```sparql
SELECT ?city ?pop WHERE {
  VALUES (?city) { (UNDEF) }
  ?city :population ?pop .
}
```

That clause declares one parameter with the signature `(?city)`. The reserved
row must be the clause's only row; a block that merely *contains* an all-UNDEF
row alongside bound rows is not a parameter. Three such clauses declare three
table parameters, matched in order of appearance.

**A named number is `LIMIT 000n` or `OFFSET 000n`.** In `LIMIT 00010` the
parameter's name is `10` — the digits after the `000`. Names are digits only:
detection matches `/\bLIMIT\s+000(\d+)\b/i`. The literal value is what the query
runs with when no argument is supplied, so an unparameterised run still
executes.

**How values are applied.** At execution the query is parsed and the reserved
all-UNDEF row is replaced by the supplied rows inside the parsed structure; a
named limit or offset has its number substituted. Argument values are never
concatenated into query text. A supplied row may bind only some of a clause's
variables — an unbound cell stays `UNDEF`, matching anything — but an all-UNDEF
row cannot be mixed with bound rows in one argument.

When a parameter receives no rows at all, the edge or input feeding it carries a
`whenEmpty` policy: `unconstrained` drops the clause and runs open,
`propagateEmpty` propagates the empty result, `require` refuses the run.

## ArgumentSet

An **ArgumentSet** is one call's worth of input: one argument for every parameter
the callable declares. For a query that is a table per `VALUES` clause and a
number per named limit or offset; for a query group, also one graph per
start-node graph port. Each table's rows are stored as one SPARQL Results JSON
string, and a graph binding holds either pasted RDF or a pinned
`DataGraphVersion`.

Argument sets belong to a library and are listed library-wide. They record where
they were made as provenance, not as a fence: a set made on one query can be
offered to another, and the server judges it `fits`, `partial` or `mismatch`
against that callable's signature. A version is immutable, so a test or an MCP
call that pins one is reproducible. A run may supply inline values for parameters
a named set leaves open; supplying both for the same parameter is refused by
name. Argument set routes use `/v` rather than `/versions` — the one entity that
differs.

## QueryGroup

A **QueryGroup** is a directed acyclic graph of execution steps — the canvas.
A **QueryGroupVersion** snapshots its nodes, its edges and the canvas layout.

Node types are `StartNode`, `EndNode`, `QueryNode` (a pinned query version),
`DynamicQueryNode` (a query chosen at execution time), `RuleSetNode`,
`PatchNode` and `DuckDbEtlNode`. A **`QueryEdge`** connects one node's output to
another's input, and its `dataFlowType` says what travels along it:

| `dataFlowType` | Carries | Source I/O → target I/O |
| --- | --- | --- |
| `CONTROL_FLOW` | nothing; an ordering dependency only | none — an edge of this type with I/O references is refused |
| `VARIABLE_BINDINGS` | a solution sequence | `QueryOutputTuple` → `QueryInputTuple` |
| `RDF_GRAPH` | triples or quads | `TriplesQuadsIO` → `TriplesQuadsIO` |
| `BOOLEAN` | an ASK result | `BooleanIO` → `BooleanIO` |
| `QUERY_ID` | a single column naming a query to run | `QueryOutputTuple` → `QueryIdInput` |

Variables are lined up across an edge by `variableMappings`, a
`{ source, target }[]` list of variable *names*. Unset, the default pairs exact
names first and the remainder by position.

The **start node's** outputs are the group's own parameters: one port per table
input, plus any graph ports. A group also takes `LIMIT` and `OFFSET` parameters,
which are the union of the named numbers its member query versions declare — a
value for `pageSize` reaches every node whose query names `pageSize`, so two
nodes sharing a name share the value and a node that must page independently
renames its parameter.

## DataGraph

A **DataGraph** is reference RDF registered in a library. A `DataGraphVersion`
stores the serialisation verbatim (Turtle, N-Triples, and so on) with a triple
count and a byte size.

A data graph is *input that goes in and does not come out*. It seeds the store a
rule set or a hermetic query test runs against, fills a query group's graph port,
or hydrates a backend. It is not part of a rule set, so it never appears in an
inference graph.

## TupleSet

A **TupleSet** is a named, versioned table of RDF terms — a solution sequence —
stored in a library. A `TupleSetVersion` stores its content as a standard SPARQL
Results JSON document, along with `columns`, `rowCount`, `byteSize` and the
`sourceFormat` it was imported from (CSV, TSV, SPARQL Results TSV, SPARQL
Results JSON, or saved query results).

A tuple set is *tabular input*. It is never loaded into a store: it is spliced
into a query's `VALUES` clause, or matched against a rule set's `TUPLE( … )`
declaration, and consumed. Untyped sources (CSV, plain TSV) import as plain
string literals unless column types are chosen at import. Blank nodes are
rejected at import, because a blank node label is document-scoped and can join
with nothing in the target store.

### Graphs and tuples compared

| | DataGraph | TupleSet |
| --- | --- | --- |
| Content | an RDF graph | a table of RDF terms |
| Stored as | the original serialisation, verbatim | normalised SPARQL Results JSON |
| Version records | `tripleCount`, `byteSize` | `rowCount`, `byteSize`, `columns` |
| At execution | loaded into a store | spliced into a `VALUES` clause or a `TUPLE( … )` |
| Consumed by | rule sets, group graph ports, backends, test fixtures | queries and rule sets |

That difference is why tabular input is a *parameter* and RDF input is *data*.

## Rule, DataBlock and RuleSet

sqlib authors SPARQL-RL inference rules in **SRL** (the SPARQL Rule Language of
[SPARQL 1.2 RL](https://www.w3.org/TR/sparql12-rl/)), a
textual syntax parsed, compiled and stratified by `packages/srl`.

- A **Rule** is one inference rule: a head and a body. Its version stores the
  rule text, the grammar it was written in (`srl` or `sparql`), whether it
  parsed, and the normalised `INSERT` it compiles to.
- A **DataBlock** is a set of triples that are part of the rule set. It compiles
  to `INSERT DATA`, and its triples *do* appear in the inference graph — which
  is what distinguishes it from a data graph.
- A **RuleSet** groups them. A `RuleSetVersion` holds `hasRule` and
  `hasDataBlock` as lists of *version* IRIs, never parent IRIs, so a rule set's
  behaviour cannot change because some rule got a new current version. It also
  stores a stratification report: the dependency structure the stratifier found,
  and whether it could order the rules.

A rule set runs in-process against a base graph, which is a `DataGraph`. It has
no backend to name: fetching data from a live endpoint and then running rules
over it is a query group, not a rule set with an endpoint.

## The three things called "tuple"

Three distinct concepts share the word.

| Name | What it is | Where it appears |
| --- | --- | --- |
| **TupleSet** | a library entity: a saved table of RDF terms | the Tuples rail; fills a query's `VALUES` clause or a rule set's `TUPLE( … )` |
| **SRL rule tuples** | a language extension: `TUPLE( … )` declarations in an SRL document, with a rule set version's `tuplesEnabled` toggle and `tupleSeeds` | inside rule text; gated by the `ruleTuples` feature flag (`FEATURE_RULE_TUPLES`, default off) |
| **`QueryInputTuple` / `QueryOutputTuple`** | internal I/O entities: the declared signature of one `VALUES` clause or one result shape | query versions' `inferredInputs` / `inferredOutputs`, and the canvas's node ports |

They interact but are not each other. A tuple set can *fill* an SRL `TUPLE( … )`
parameter, and it can *fill* the parameter a `QueryInputTuple` describes, but it
is neither of them. The `ruleTuples` feature flag gates only the middle row: with
it off the server refuses `TUPLE( … )` syntax, `tuplesEnabled` and `tupleSeeds`,
and the UI draws no control mentioning the extension. The `TupleSet` entity, the
Tuples rail and argument sets are unaffected by it. Tuple *seeds* are a fourth
spelling of that middle row: an SRL text document of ground `TUPLE( … )` rows
supplied per run rather than a reference to a stored table.

## Backend

A **Backend** is where a query executes. Three types: `http`, a remote SPARQL
endpoint; `oxigraphMemory`, an in-process Oxigraph store held in memory whose
`mode` says whether its contents are serialised to disk on a checkpoint interval
and on shutdown; and `oxigraphEphemeral`, an in-process store that is never
serialised and dies with the process.

A backend stores an `authEnvKey`, the *name* of an environment variable group
rather than a credential. Credentials are read from
`SQLIB_BACKEND_<KEY>_USERNAME` / `_PASSWORD`, or
`SQLIB_BACKEND_<KEY>_AUTH_HEADER`, in the server's own environment, so they never
enter the library. Which backend a run uses is resolved by precedence: the one
named on the call, then the query's `defaultBackend`, then the library's.

## Test

A **Test** is an invocation plus an expectation, run once, judged pass or fail.
Its `subject` is a `Query`, a `QueryGroup` or a `RuleSet`, and its `subjectKind`
names which; a `TestVersion` holds the inputs and the expectation. A test may
also record a `criterion`, an external manifest entry IRI, for tests seeded from
a conformance suite. Which inputs it may supply depends on its subject's kind,
and the rules are stated once, in `packages/types/src/subjectKinds.ts`:

| Subject | Backend on the version | Data graph per case | Argument set per case | Tuple seeds | SQL fixture |
| --- | --- | --- | --- | --- | --- |
| Query | yes | yes | yes | no | no |
| Query group | no | yes | yes | no | no |
| Rule set | no | yes | no | yes | no |
| ETL job | no | yes | no | no | yes |

A query is the one kind with an exclusive store: it names a backend *or* gives
every case a data graph to run against hermetically, never both and never
neither. A query group's nodes name their own backends, so its test has none to
name.

## Benchmark

A **BenchmarkExperiment** measures a callable rather than judging it. Its
version holds one or more subject specs, which have the same "a callable plus
its inputs" shape as a test's invocation half. A run produces iterations,
per-node runs and observations, so timings can be read per node as well as per
call.

## ETL pipeline

An **EtlJob** builds RDF from tabular sources. Its version holds DuckDB `sql`, a
`sparqlTemplate` that constructs triples from the rows that SQL returns, the
target `backendId`, a chunk size, and a pointer to a column-mapping version; an
`EtlExecution` records a run.

An ETL job declares no parameters: its tabular input is the rows its SQL reads.
That is why an ETL test supplies a SQL fixture — DuckDB statements run on the
job's own connection, against a database that exists only for that case — rather
than an argument set.

ETL is off by default (`FEATURE_ETL`, `FEATURE_PLAYGROUND_ETL`), because
arbitrary DuckDB SQL is a host filesystem read primitive and, with the httpfs
extension, an outbound request primitive.
