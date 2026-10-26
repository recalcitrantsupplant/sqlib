# Dataset inputs: FROM and FROM NAMED supplied at run time

This proposes letting a caller, or an upstream query in a query group, choose
the RDF dataset a query runs over. The dataset is the set of graphs that
`FROM` and `FROM NAMED` would otherwise name in the query text. sqlib would
pass it to SPARQL endpoints as the SPARQL 1.1 Protocol parameters
`default-graph-uri` and `named-graph-uri`, and to Oxigraph as the equivalent
query options.

The main use is in query groups. Query q1 selects a set of graphs, for example
the graphs a user may read, and q2 runs restricted to that set. Whatever logic
decides the set lives in q1: graph membership, a hierarchy, the time of day.

Nothing here is implemented. The measurements in
[Measured cost](#measured-cost) were taken on 2026-10-16 with
[`dataset-inputs-benchmark.mjs`](dataset-inputs-benchmark.mjs).

## Summary of proposed changes

1. Add a dataset (`defaultGraphs`, `namedGraphs`) to `SparqlQueryOptions` in
   `packages/api/src/server/ISparqlExecutor.ts`.
2. Send the dataset as protocol parameters from
   `packages/api/src/server/HttpSparqlExecutor.ts` and
   `packages/runtime/src/executor.ts`, using a form-encoded POST whenever a
   dataset is present.
3. Pass the dataset as `default_graph` / `named_graphs` options from
   `packages/api/src/server/OxigraphSparqlExecutor.ts` and
   `packages/runtime-oxigraph/src/index.ts`.
4. Accept a dataset on the `/sparql` route (`packages/api/src/routes/sparql.ts`),
   on query and group execution, and on the matching MCP tools.
5. Add a `DATASET` edge flow type to query groups
   (`packages/api/src/lib/orchestration/types.ts`), carrying a one-variable
   SELECT result into the target query's dataset.
6. Run a query whose supplied dataset is empty against an empty dataset, never
   against the backend's default dataset.

A policy mechanism built on these changes, where the allowed graphs come from
an auth graph users cannot read, is discussed in
[Policy queries and the auth graph](#policy-queries-and-the-auth-graph). It
needs further design and is not part of this change set.

## Background: the protocol parameters

[SPARQL 1.1 Protocol §2.1.4](https://www.w3.org/TR/sparql11-protocol/#dataset)
defines two query parameters, each of which may appear zero or more times:

- `default-graph-uri`: the graphs merged to form the default graph, as `FROM`
  does in the query text.
- `named-graph-uri`: the graphs available to `GRAPH` patterns, as
  `FROM NAMED` does.

Where they go depends on how the query is sent:

| Request | `query` | Dataset parameters |
| --- | --- | --- |
| GET | URL query string | URL query string |
| POST, `application/x-www-form-urlencoded` | form body | form body |
| POST, `application/sparql-query` | request body | URL query string |

When a request specifies a dataset and the query text has `FROM` or
`FROM NAMED`, the service must use the request's dataset. A service may also
refuse requests that specify a dataset. SPARQL Update has its own pair,
`using-graph-uri` and `using-named-graph-uri`, which this proposal does not
cover.

Restricting a query to a set of graphs needs both parameters. Sending only
`named-graph-uri` leaves the default graph empty
([SPARQL 1.1 Query §13.2](https://www.w3.org/TR/sparql11-query/#specifyingDataset)),
so triple patterns outside `GRAPH` match nothing.

A dataset restriction differs from `VALUES ?g { UNDEF }` followed by
`GRAPH ?g { … }`, which sqlib supports today. VALUES constrains only the
patterns the query author wraps in `GRAPH ?g`. A dataset restriction applies
to the whole query, including queries written without it in mind.

## Proposed changes

### 1. A dataset on the executor options

```ts
export type SparqlDataset = {
  /** IRIs merged into the default graph. Absent: the backend's default graph. */
  defaultGraphs?: string[];
  /** IRIs available to GRAPH patterns. Absent: the backend's named graphs. */
  namedGraphs?: string[];
};

export type SparqlQueryOptions = {
  acceptHeader?: string;
  signal?: AbortSignal;
  dataset?: SparqlDataset;
};
```

An absent list and an empty list mean different things. Absent leaves that
part of the dataset to the backend. Empty means no graphs (see change 6).

Values must be IRIs. A literal or blank node is rejected before the query is
sent.

### 2. HTTP backends

`HttpSparqlExecutor` already sends queries as form-encoded POST by default
(`HttpSparqlExecutor.ts:94`). The dataset parameters are appended to the same
body, one `default-graph-uri=` or `named-graph-uri=` pair per IRI.

A backend configured with `queryMethod: 'get'` would put the dataset in the
URL. At 10,000 graphs Fuseki returned HTTP 414 (see
[Measured cost](#measured-cost)), and proxies limit URLs well below that:
nginx's default `large_client_header_buffers` is 8 KB, which holds about 145
graph IRIs of 30 characters once percent-encoded. The proposal is to use
form-encoded POST whenever a dataset is present, regardless of `queryMethod`.

The runtime executor in `packages/runtime/src/executor.ts` sends POST queries
as `application/sparql-query`, which puts dataset parameters in the URL. It
should switch to a form-encoded POST when a dataset is present. Its `auto`
method, which chooses GET when the URL fits in `maxUrlLength`, should count
the dataset parameters in that length.

### 3. Oxigraph backends

Oxigraph 0.5.11's `Store.query` accepts `default_graph`, `named_graphs` and
`use_default_graph_as_union`
(`packages/api/node_modules/oxigraph/node.d.ts:154`). The executors call
`store.query(sparqlQuery)` with no options today
(`OxigraphSparqlExecutor.ts:57`, `:82`, `:331`). They would map
`defaultGraphs` to `default_graph` and `namedGraphs` to `named_graphs`, as
arrays of `NamedNode`.

The benchmark confirmed that the options take precedence over `FROM NAMED` in
the query text, as the protocol requires of an endpoint.

### 4. Request surfaces

- **`GET /sparql`**: accept repeated `default-graph-uri` and `named-graph-uri`
  query parameters, using the protocol names.
- **`POST /sparql`**: the body is JSON today. Add `defaultGraphs` and
  `namedGraphs` as arrays of IRI strings. Accepting form-encoded POST with the
  protocol parameter names, so that standard SPARQL clients can use the route,
  is a separate change and needs a form body parser.
- **Query and group execution, and the MCP tools `execute_run` and
  `sparql_proxyQuery`**: accept the same `defaultGraphs` and `namedGraphs`
  arrays. For a group, a caller-supplied dataset applies to every node that
  has no `DATASET` edge, and is intersected with the edge's dataset where one
  exists (see change 5).

### 5. `DATASET` edges in query groups

Query groups wire nodes with typed edges (`EdgeFlowType` in
`packages/api/src/lib/orchestration/types.ts`). `VARIABLE_BINDINGS` carries a
SELECT result into a VALUES slot, and `QUERY_ID` carries a one-variable
output into a dynamic node's query id. A `DATASET` edge would follow the
`QUERY_ID` precedent:

- The source is a SELECT output with one variable, whose values must be IRIs.
- The edge names its target part: `default`, `named` or `both`. The default is
  `both`, which restricts the query to the selected graphs.
- The target is the query node's dataset, which is not declared in the query
  text, so every query node accepts at most one `DATASET` edge per part.

When the caller also supplies a dataset, the node runs over the intersection
of the two. Letting the caller's dataset replace the edge's would let a caller
widen a restriction the group author set.

### 6. Empty datasets

Over HTTP, sending no dataset parameters means "use the endpoint's default
dataset", which is usually everything. If q1 selects no graphs and sqlib sends
no parameters, q2 runs unrestricted.

Edges already carry a `whenEmpty` policy (`WhenEmptyMode` in
`packages/api/src/persistence/schemas/QueryEdgeSchema.ts`), and an absent
external input defaults to `unconstrained`
(`ExecutionEngine.ts:818`). For `DATASET` edges:

- The default is `propagateEmpty`, and `unconstrained` is refused.
- An empty dataset runs the query against an empty dataset. For Oxigraph that
  is `named_graphs: []` and `default_graph: []`; the benchmark confirmed that
  `named_graphs: []` returns no matches. For HTTP it is a sentinel IRI that
  names no graph, `urn:sqlib:empty-dataset`, sent as both parameters.

Running against an empty dataset is preferred over skipping the query and
returning no rows, because some queries return rows over an empty dataset:
`SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }` returns one row with `?n = 0`.

## Measured cost

The benchmark loaded 20,000 named graphs of 10 triples each (200,000 quads)
and ran `SELECT (COUNT(*) AS ?c) WHERE { GRAPH ?g { ?s ?p ?o } }` restricted
to 10, 100, 1,000 and 10,000 of them, taking every second graph. Times are
medians of 5 runs, in milliseconds.

| Method | 10 | 100 | 1,000 | 10,000 |
| --- | --- | --- | --- | --- |
| Oxigraph `named_graphs` option | 0.2 | 0.9 | 5.6 | 47 |
| Oxigraph `default_graph` option | 0.2 | 0.6 | 5.0 | 49 |
| Oxigraph `VALUES ?g` in the query | 0.2 | 0.5 | 4.8 | 48 |
| Oxigraph `FROM NAMED` in the query | 0.2 | 0.5 | 4.1 | 46 |
| Fuseki GET, `named-graph-uri` | 10 | 12 | 17 | HTTP 414 |
| Fuseki form POST, `named-graph-uri` | 9 | 8 | 15 | 176 |
| Fuseki form POST, `default-graph-uri` | 8 | 9 | 18 | 259 |
| Fuseki form POST, `VALUES ?g` | 8 | 9 | 20 | 132 |
| Fuseki form POST, `FROM NAMED` in the query | 6 | 8 | 30 | 374 |

Without a restriction, the same query over all 20,000 graphs took 51 ms on
Oxigraph and 130 ms on Fuseki.

- On Oxigraph all methods cost about the same. Time follows the number of
  matching triples, not the number of graph IRIs.
- On Fuseki, protocol parameters at 10,000 graphs cost 1.3 to 2 times the
  unrestricted query. Below 1,000 graphs the HTTP round trip, about 8 ms,
  dominates.
- Writing the graphs into the query text as `FROM NAMED` was the slowest
  Fuseki method, so sqlib should not rewrite the query text to apply a
  dataset.
- With `FROM NAMED` naming 100 graphs in the query and `named-graph-uri`
  naming 10, both engines returned the 10-graph count.

Setup: Oxigraph 0.5.11 in-process; Fuseki in memory (`--mem`) from the
`ghcr.io/kurrawong/fuseki-lucene-shacl:sha-e2f4b0d` image, called over HTTP
from Node 24 on the same machine.

These numbers do not cover a persistent store such as TDB2, joins across
graphs, or larger graphs, any of which could rank the methods differently.
Fuseki accepted a 550 KB form body; other servers' form size limits have not
been checked. Jetty's default limit is 200 KB, so a Jetty-based endpoint with
default settings may reject large datasets.

## Policy queries and the auth graph

The intended use, q1 deciding which graphs q2 may read, is an access-control
mechanism only if users cannot read or change the data and query behind q1.
A separate backend for the auth graph does not ensure that on its own: any
route that runs SPARQL against that backend can return its contents. The
mechanism needs these conditions:

1. No user-facing route can query the auth backend directly. That includes
   `/sparql`, execution of a user's own query, and groups users can edit.
2. The policy query is owned by an administrator and pinned to a version, so
   callers cannot edit it, replace it or rewire its output.
3. The policy query's output is never returned to the caller. It is used only
   as the dataset of the query it restricts.
4. The caller's identity reaches the policy query from the authenticated
   request, not from request arguments. Otherwise a caller can pass someone
   else's identity. No current input kind marks a value as server-supplied.
5. The restriction applies on every route to the data backend. A restriction
   that applies only inside groups is bypassed by the plain `/sparql` route.

Conditions 1 and 5 suggest attaching the policy to the data backend rather
than to a query group: every query against backend B first runs policy query
P with the caller's identity and uses P's result as its dataset. The same
model covers an auth graph stored in the data backend itself, since the auth
graph's IRI is never in an allowed set, provided no route skips the
restriction.

Two limits remain under that model. A user can infer which graphs they may
read from the results they get back. An endpoint that ignores the dataset
parameters returns unrestricted results without an error; a check when the
backend is registered, such as a query that should return nothing under a
sentinel dataset, would detect it.

## Open questions

- Should a backend record whether it honours dataset parameters, so sqlib can
  refuse to apply a policy to one that does not?
- Should query text be allowed to keep `FROM` / `FROM NAMED` when a dataset is
  supplied? Both engines tested ignore the text's dataset, so the clauses
  would have no effect and could mislead a reader.
- Are dataset parameters for SPARQL Update (`using-graph-uri`,
  `using-named-graph-uri`) needed?

## Tests to add

- Override precedence: query text with `FROM NAMED` plus a smaller supplied
  dataset returns the supplied dataset's result, on Oxigraph and over HTTP.
- An empty supplied dataset returns no matches on Oxigraph and over HTTP, and
  `COUNT(*)` returns 0.
- `queryMethod: 'get'` with a dataset sends a form-encoded POST.
- A `DATASET` edge with `whenEmpty: 'unconstrained'` is rejected when the
  group version is saved.
- A caller-supplied dataset on a node with a `DATASET` edge yields the
  intersection.
