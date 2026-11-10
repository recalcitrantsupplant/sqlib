# Concepts

This page defines the terms that the rest of the documentation uses, and the
relationships between the things they name. Read it before the guides. Some
words in sqlib name more than one thing. "Tuple" names three.

## Library

A **Library** contains all other entities. Each query, query group, rule set,
data graph, tuple set, argument set, test, benchmark and ETL job belongs to one
library. A library can name a `defaultBackend`: the backend its queries run on
when the call names no other. One server holds many libraries. You export,
import and copy a library as one unit.

## Stable pointers and immutable versions

Most entities have two parts:

- A **stable pointer** (`Query`, `RuleSet`, `DataGraph`, `TupleSet`,
  `ArgumentSet`, `Test`, `EtlJob`, `BenchmarkExperiment`) holds the name,
  description, tags and a `currentVersion` link. Its IRI does not change.
- An **immutable version** (`QueryVersion`, `RuleSetVersion` and so on) holds
  the content and a numeric `version`. After it is saved, nothing changes it.

An execution always names a version, so you can run it again and get the same
result. There are two ways to refer to content:

- A **pin** is a version IRI. It always means the same content.
- A **float** is the IRI of the stable pointer. It means the current version of
  that entity at the time of the call.

## Query and QueryVersion

A **Query** is a stable, named pointer. It can name a `defaultBackend`. A
**QueryVersion** holds the SPARQL text (`queryString`), the query type, the
parameters found in the text, and the inputs and outputs inferred from it. A
query version is *callable*: it declares parameters, and you call it with
arguments.

## Parameters

A query declares its parameters in the query text. There are two forms.

**A table parameter is a `VALUES` clause whose only row is all `UNDEF`.**

```sparql
SELECT ?city ?pop WHERE {
  VALUES (?city) { (UNDEF) }
  ?city :population ?pop .
}
```

This clause declares one parameter with the signature `(?city)`. The all-`UNDEF`
row must be the only row in the clause. A `VALUES` block that has an all-`UNDEF`
row and also bound rows is plain data. Three such clauses declare three table
parameters, in the order they appear.

**A named number is `LIMIT 000n` or `OFFSET 000n`.** In `LIMIT 00010` the name
of the parameter is `10`: the digits after `000`. Names are digits only.
Detection matches `/\bLIMIT\s+000(\d+)\b/i` against the code of the query, so
the same text in a comment or a string literal declares nothing. When no
argument is supplied, the query runs with the literal value. A run without
arguments therefore still executes.

**How values are applied.** Each argument for a table parameter is a **SPARQL
Query Results JSON** document, which is the form a SELECT returns:

```json
{ "head": { "vars": ["city"] },
  "results": { "bindings": [ { "city": { "type": "uri", "value": "http://example.org/Perth" } } ] } }
```

You can pass the output of a query, a stored tuple set, or the response of
another endpoint as an argument, with no edits. sqlib matches each argument to a
`VALUES` clause by the variables in `head.vars`, and a request carries at most
one argument per clause. sqlib refuses blank nodes, because a blank node label
has meaning only inside its own document. The old `typed-literal` form is read
as a `literal` with its datatype.

At execution, sqlib parses the query and puts the supplied rows in place of the
all-`UNDEF` row, in the parsed structure. It puts the supplied number in place
of a named limit or offset. sqlib does not concatenate argument values into
query text. A supplied row can bind some of the variables of a clause. A cell
with no value stays `UNDEF` and matches anything. One argument cannot mix an
all-`UNDEF` row with bound rows.

**Empty input.** A caller can send two different signals with the same table:

| The request | Means | The clause becomes |
| --- | --- | --- |
| leaves the parameter out | no input, so do not filter | removed |
| supplies it with zero rows | the empty set, so match nothing | `VALUES` with zero rows |

sqlib refuses an argument that fits no clause. The error names the variables of
the argument and the clauses that the query declares.

In a query group, the edge into a clause can have a `whenEmpty` policy. It
applies when the upstream node produces no rows:

- `unconstrained` removes the clause.
- `propagateEmpty` keeps the zero-row block.
- `require` refuses the run.

The policy belongs to the author of the group, so it is set on the edge. A
request cannot set it.

The author of a query can set the same policy on the clause itself, on the
input tuple of the version. A clause marked `require` refuses a run that leaves
it out, sends one all-`UNDEF` row, or sends zero rows. A query that must start
from a value therefore never scans the whole graph. A group edge can choose a
different closed mode for that clause, but it cannot set `unconstrained`. See
[required arguments](proposals/required-arguments.md).

**A constant parameter is a one-variable slot whose name starts with `000`.**

```sparql
PREFIX ts: <https://qlever.cs.uni-freiburg.de/textSearch/>
SELECT ?entity WHERE {
  VALUES ?000word { UNDEF }
  SERVICE ts: { ?t ts:contains [ ts:word ?000word ] ; ts:contains [ ts:entity ?entity ] }
}
```

You fill it in the same way as a table parameter, but it takes exactly one
bound value. sqlib refuses zero rows, two rows, an `UNDEF` cell and an omitted
argument, and names the parameter.

The filled `VALUES` row stays. sqlib also writes the same term into the triple
patterns in the scope of the clause. The scope is the group that holds the
clause, and the groups nested in it through plain groups, `GRAPH` and `SERVICE`
bodies and `UNION` branches. An engine that needs a constant to plan the query,
such as QLever text search, therefore gets one. The answer is the same as for a
plain `VALUES` run. Each other occurrence keeps the variable.

At some occurrences, the answer can then differ: `OPTIONAL`, `MINUS`, `EXISTS`,
a sub-`SELECT`, `BIND`, a nested `FILTER`, and a `GRAPH` or `SERVICE` name.
Detection reports these as `constantWarnings`. The query still saves and runs.
A query with a constant uses the parser path, and cannot be exported. See
[constant substitution](proposals/constant-substitution.md).

**A value pattern** is a regular expression on the input tuple of a slot
(`valuePattern`, set through `inputPolicies` when you save a version). Each
bound value of the slot must match it. It limits what an engine reads in a
literal, for example a short `*` search word that matches too much.

## ArgumentSet

An **ArgumentSet** holds the values for the SPARQL parameters of a callable: one
table for each `VALUES` clause and one number for each named limit or offset.
The rows of each table are stored as one SPARQL Results JSON string. This is the
same document that a run accepts inline.

An argument set holds no graphs. The data graphs of a query group are a separate
input. A run sends them in `dataGraphs[]`, next to its argument sets, in the same
way as the data graph of a rule set. See
[argument sets without graphs](proposals/argument-sets-without-graphs.md).

Argument sets belong to a library, and the library lists all of them. Each set
records the callable it was made on, as provenance. You can offer a set made on
one query to another query. The server compares the set with the signature of
that callable and returns `fits`, `partial` or `mismatch`.

A version is immutable, so a test or an MCP call that pins one gives the same
result each time. A run can supply inline values for parameters that a named set
does not fill. If a run supplies both for the same parameter, sqlib refuses it
and names the parameter. Argument set versions are under
`/argument-sets/:id/versions`, the same path segment that each versioned entity
uses.

## Browser defaults

A query and a query group can name a default argument set. A query group and a
rule set can name a default data graph for each data graph input. The web app
selects these defaults when you open the callable and nothing else is selected.
The server stores them, so each user of the library gets the same defaults.

**Execution never applies a browser default.** `/execute`, rule set execution,
tests, benchmarks and MCP use only the inputs that the caller sends. An empty
call means "no arguments". A default changed in the web app must not change
what a script calculates. To use the default, a caller reads
`GET /…/:id/browser-defaults` and sends it. See
[browser defaults](proposals/browser-defaults.md).

## QueryGroup

A **QueryGroup** is a directed acyclic graph of execution steps. The web app
shows it on the canvas. A **QueryGroupVersion** stores a snapshot of its nodes,
its edges and the canvas layout.

The node types are `StartNode`, `EndNode`, `QueryNode` (a pinned query version),
`DynamicQueryNode` (a query chosen at execution time), `RuleSetNode`,
`PatchNode` and `DuckDbEtlNode`. A **`QueryEdge`** connects the output of one
node to the input of another. Its `dataFlowType` sets what moves along it:

| `dataFlowType` | Carries | Source I/O to target I/O |
| --- | --- | --- |
| `CONTROL_FLOW` | nothing; an order dependency only | none; sqlib refuses an edge of this type that has I/O references |
| `VARIABLE_BINDINGS` | a solution sequence | `QueryOutputTuple` to `QueryInputTuple` |
| `RDF_GRAPH` | triples or quads | `TriplesQuadsIO` to `TriplesQuadsIO` |
| `BOOLEAN` | an ASK result | `BooleanIO` to `BooleanIO` |
| `QUERY_ID` | one column that names a query to run | `QueryOutputTuple` to `QueryIdInput` |
| `DATASET` | one column of graph IRIs, used as the dataset of the target | `QueryOutputTuple` to the `FROM` / `FROM NAMED` of the target query (no input port) |

`variableMappings` pairs the variables across an edge. It is a
`{ source, target }[]` list of variable *names*. If it is not set, sqlib pairs
equal names first, then pairs the rest by position.

The outputs of the **start node** are the parameters of the group: one port for
each table input, and any graph ports. A group also takes `LIMIT` and `OFFSET`
parameters. These are the union of the named numbers that its query versions
declare. A value for `pageSize` goes to each node whose query names `pageSize`.
Two nodes with the same name therefore get the same value. To page a node on its
own, give its parameter a different name.

## DataGraph

A **DataGraph** is reference RDF registered in a library. A `DataGraphVersion`
stores the serialisation as written (Turtle, N-Triples and so on), with a triple
count and a byte size.

A data graph is input only. It fills the store that a rule set or a hermetic
query test runs against, fills a graph port of a query group, or loads a
backend. It is not part of a rule set, so its triples are never in an inference
graph.

## TupleSet

A **TupleSet** is a named, versioned table of RDF terms (a solution sequence)
stored in a library. A `TupleSetVersion` stores the content as a SPARQL Results
JSON document, with `columns`, `rowCount`, `byteSize` and the `sourceFormat` it
was imported from: CSV, TSV, SPARQL Results TSV, SPARQL Results JSON, or saved
query results.

A tuple set is tabular input. sqlib never loads it into a store. sqlib puts it
into the `VALUES` clause of a query, or matches it against a `TUPLE( … )`
declaration in a rule set. Sources without types (CSV, plain TSV) import as
plain string literals, unless you choose column types at import. Import refuses
blank nodes, because a blank node label belongs to one document and cannot join
with anything in the target store.

### Graphs and tuples compared

| | DataGraph | TupleSet |
| --- | --- | --- |
| Content | an RDF graph | a table of RDF terms |
| Stored as | the original serialisation, as written | normalised SPARQL Results JSON |
| Version records | `tripleCount`, `byteSize` | `rowCount`, `byteSize`, `columns` |
| At execution | loaded into a store | put into a `VALUES` clause or a `TUPLE( … )` |
| Used by | rule sets, group graph ports, backends, test fixtures | queries and rule sets |

For this reason, tabular input is a *parameter* and RDF input is *data*.

## Rule, DataBlock and RuleSet

sqlib writes SHACL 1.2 inference rules in **SRL** (Shape Rules Language). SRL is
a text syntax. `packages/srl` parses, compiles and stratifies it.

- A **Rule** is one inference rule: a head and a body. Its version stores the
  rule text, the grammar it uses (`srl` or `sparql`), whether it parsed, and the
  normalised `INSERT` it compiles to.
- A **DataBlock** is a set of triples that belong to the rule set. It compiles
  to `INSERT DATA`. Its triples appear in the inference graph. The triples of a
  data graph do not.
- A **RuleSet** groups rules and data blocks. A `RuleSetVersion` holds `hasRule`
  and `hasDataBlock` as lists of *version* IRIs. A new current version of a rule
  therefore cannot change what a saved rule set does. The version also stores a
  stratification report: the dependency structure that the stratifier found,
  and whether it could put the rules in order.

A rule set runs in the server process against a base graph, which is a
`DataGraph`. A rule set names no backend. To fetch data from a live endpoint and
then run rules on it, build a query group.

## The three things called "tuple"

| Name | What it is | Where it appears |
| --- | --- | --- |
| **TupleSet** | a library entity: a saved table of RDF terms | the Tuples rail; fills the `VALUES` clause of a query or a `TUPLE( … )` in a rule set |
| **SRL rule tuples** | a language extension: `TUPLE( … )` declarations in an SRL document, with the `tuplesEnabled` switch and `tupleSeeds` of a rule set version | in rule text; controlled by the `ruleTuples` feature flag (`FEATURE_RULE_TUPLES`, default off) |
| **`QueryInputTuple` / `QueryOutputTuple`** | internal I/O entities: the declared signature of one `VALUES` clause or one result shape | `inferredInputs` / `inferredOutputs` of a query version, and the node ports on the canvas |

A tuple set can fill an SRL `TUPLE( … )` parameter. It can also fill the
parameter that a `QueryInputTuple` describes. It is a separate thing from both.

The `ruleTuples` feature flag controls the middle row only. When the flag is
off, the server refuses `TUPLE( … )` syntax, `tuplesEnabled` and `tupleSeeds`,
and the UI shows no control for the extension. The flag has no effect on the
`TupleSet` entity, the Tuples rail or argument sets. Tuple *seeds* are a fourth
form of the middle row: an SRL text document of ground `TUPLE( … )` rows,
supplied with each run. A seed holds the rows itself, where a tuple set is a
stored table.

## Backend

A **Backend** is where a query executes. There are three types:

- `http`: a remote SPARQL endpoint.
- `oxigraphMemory`: an Oxigraph store in the server process, held in memory.
  Its `mode` sets whether sqlib writes its contents to disk at a checkpoint
  interval and at shutdown.
- `oxigraphEphemeral`: a store in the server process that sqlib never writes to
  disk. It is lost when the process stops.

A backend stores an `authEnvKey`. This is the *name* of a group of environment
variables. sqlib reads the credentials from `SQLIB_BACKEND_<KEY>_USERNAME` and
`_PASSWORD`, or from `SQLIB_BACKEND_<KEY>_AUTH_HEADER`, in the environment of
the server. Credentials are therefore never in the library. sqlib chooses the
backend for a run in this order: the backend named on the call, then the
`defaultBackend` of the query, then that of the library.

## Test

A **Test** is a call and an expected result. sqlib runs it once and records pass
or fail. Its `subject` is a `Query`, a `QueryGroup` or a `RuleSet`, and its
`subjectKind` says which. A `TestVersion` holds the inputs and the expected
result. A test can also record a `criterion`: the IRI of an entry in an external
manifest, for tests made from a conformance suite.

The inputs that a test can supply depend on the kind of its subject.
`packages/types/src/subjectKinds.ts` defines the rules:

| Subject | Backend on the version | Data graph per case | Argument set per case | Tuple seeds | SQL fixture |
| --- | --- | --- | --- | --- | --- |
| Query | yes | yes | yes | no | no |
| Query group | no | yes | yes | no | no |
| Rule set | no | yes | no | yes | no |
| ETL job | no | yes | no | no | yes |

A query test must use exactly one store. It names a backend, or it gives each
case a data graph to run against hermetically. The nodes of a query group name
their own backends, so a query group test names none.

## Benchmark

A **BenchmarkExperiment** measures the time a callable takes. Its version holds
one or more subject specs. A subject spec has the same form as the call part of
a test: a callable and its inputs. A run produces iterations, runs per node and
observations, so you can read timings for each node and for the whole call.

## ETL pipeline

An **EtlJob** builds RDF from tabular sources. Its version holds:

- DuckDB `sql`.
- A `sparqlTemplate` that constructs triples from the rows the SQL returns.
- The target `backendId`.
- A chunk size.
- A pointer to a column-mapping version.

An `EtlExecution` records a run.

An ETL job declares no parameters. Its tabular input is the rows its SQL reads.
An ETL test therefore supplies a SQL fixture: DuckDB statements that run on the
connection of the job, against a database that exists only for that test case.

ETL is off by default (`FEATURE_ETL`, `FEATURE_PLAYGROUND_ETL`). DuckDB SQL can
read any file on the host, and with the httpfs extension it can send outbound
requests.
