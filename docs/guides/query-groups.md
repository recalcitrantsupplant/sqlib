# Query groups: chaining queries

A query group runs several callables in dependency order and passes results
between them. This guide describes what a group is, how to build one on the
canvas, how to build and run one over HTTP, and its known limits.

## 1. What a query group is

A **query** runs one SPARQL string against one store. A **query group** runs
several callables in dependency order and passes results between them:

- The rows that one node returns become the `VALUES` rows of the next node.
- An RDF graph that one node builds becomes the graph that a rule set reasons
  over.
- One column from a node can name the query that the next node runs.

A group is a DAG. You connect the data, and the engine sets the order. It takes
the nodes in topological order (Kahn, `ExecutionEngine.execute`) and runs them
one at a time. Parallel branches are valid in a DAG, but the engine runs them
one after another. This affects speed only. The results are the same.

Use a group when:

- a query needs rows that a *different* store or query produced;
- you want to save, version and run a pipeline again as one unit;
- rules must run over a graph that a `CONSTRUCT` builds first;
- the same pipeline must run with different parameters (an argument set).

If one parameterised query is sufficient, do not use a group. The smallest
useful group has four entities and three edges.

## 2. The parts

### Nodes

| Kind | Runs | Gets its work from |
| --- | --- | --- |
| **Start node** | nothing | The inputs of the group. It marks the boundary. One per group, created for you. |
| **Query node** (`QueryNode`) | one query version against one backend | `queryId` (a query version IRI) + `backendId` |
| **Dynamic query node** (`DynamicQueryNode`) | a query version chosen at run time | a `QueryIdInput` port fed by a `QUERY_ID` edge |
| **Rule set node** (`RuleSetNode`) | a rule set, in process, over the RDF it receives | `ruleSetVersion` |
| **End node** | nothing | The result of the group: the output of the node connected to it. |

Start and End are canvas nodes, but the engine does not execute them. It uses
them as control-flow markers. It fills the declared outputs of the start node
from the caller's input, and reads the result of the group from the inputs of
the end node.

`DuckDbEtlNode` exists in the schemas and the engine, but nothing can create
one. The flat writer creates `QueryNode`, `DynamicQueryNode` and `RuleSetNode`
only (`GroupVersionWriter.ts`). ETL pipelines have their own rail, outside query
groups.

### Ports

Edges connect ports. A node has ports, and an edge goes from a port on one node
to a port on another. Ports are entities, and the kind of port sets which edges
are valid:

- `QueryInputTuple` / `QueryOutputTuple`: an ordered list of variables (each
  `TupleMember` has a `position`). SELECT rows travel in this form.
- `TriplesQuadsIO`: an RDF graph, in or out.
- `BooleanIO`: an ASK result.
- `QueryIdInput`: the port that only a dynamic query node has.

For a query node, you seldom declare ports yourself. The writer merges the
`inferredInputs` / `inferredOutputs` of the query version into the ports that
the payload names. When you assign a query version to a node, the node gets its
ports. A rule set node gets one `TriplesQuadsIO` in each direction when you
assign a rule set.

An input tuple belongs to the *query version*, and each group that uses that
query shares it. For this reason, a policy for one edge, such as `whenEmpty`, is
set on the edge (section 5). The port cannot hold it.

### Edges and flow types

`packages/api/src/lib/orchestration/types.ts` defines six flow types:

| `dataFlowType` | Carries | Valid between |
| --- | --- | --- |
| `CONTROL_FLOW` | nothing; order only | any two nodes; the edge must name no ports |
| `VARIABLE_BINDINGS` | SELECT rows | output tuple (or an ASK `BooleanIO`) to input tuple; from the start node, an input tuple |
| `RDF_GRAPH` | triples/quads | `TriplesQuadsIO` to `TriplesQuadsIO` |
| `BOOLEAN` | an ASK result | `BooleanIO` to `BooleanIO` |
| `QUERY_ID` | a one-column tuple that names a query version | output tuple (arity 1) to the `QueryIdInput` of a dynamic node; from the start node, an input tuple (arity 1) |
| `DATASET` | a one-column tuple of graph IRIs | SELECT output tuple (arity 1) to the dataset of a query node; the edge names no `targetInputId` |

The start node's tuple ports are the inputs of the group, so each one is a
`QueryInputTuple`. Declare it in `inputTuples`, with its variables in `inputs`.
The API and the canvas read one table of these port rules
(`packages/contracts/src/hand-written/query-group-edge-rules.ts`):

- The writer refuses a version with an edge that leaves the start node through
  a port of another kind. The 422 names the field and has the code
  `EDGE_SOURCE_PORT_TYPE`.
- A version saved before this check can have a start port typed as a
  `QueryOutputTuple`. It still runs, and `/validate` gives the warning
  `EDGE_START_PORT_LEGACY_TYPE`. The canvas reads the port as an input tuple,
  so a save from the canvas writes it in the current form.

Two rules apply to `RDF_GRAPH`. The validator refuses an edge that breaks
either rule (`GraphBuilder.validateGraph`):

- A rule set node and the end node can receive RDF directly.
- A **SPARQL** node cannot. A query runs against a store, so RDF reaches a
  query node only if sqlib loads it into an ephemeral store that the node also
  queries. Without an ephemeral `backendConfig` on the target node, the edge
  gets `EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME`. Otherwise the edge would send
  nothing, and the node would query its own backend with no warning.

A `DATASET` edge gives its target the graphs that `FROM` and `FROM NAMED` would
name, at run time, with no change to the query text:

- `datasetPart` sets the part it fills: `default` (the default graph is the
  merge of the selected graphs), `named` (only those graphs match a `GRAPH`
  pattern), or `both` (the default).
- A node takes at most one edge for each part (`EDGE_DATASET_DUPLICATE_PART`).
- The target must be a `QueryNode` or `DynamicQueryNode` that is not an UPDATE.
- Only IRIs count. sqlib skips an unbound row or a literal.
- An empty selection means no graphs. It does not mean all graphs. `whenEmpty`
  can therefore be `propagateEmpty` (the default) or `require`, but never
  `unconstrained`.
- Over HTTP, sqlib sends the dataset as the `default-graph-uri` /
  `named-graph-uri` parameters of the SPARQL 1.1 Protocol. It sends an empty
  part as the graph `urn:sqlib:empty-dataset`, which contains nothing.
- Export bundles and the canvas do not support `DATASET` edges yet.

A `VARIABLE_BINDINGS` edge between two tuples must have **equal arity**. The
validator refuses other edges with `EDGE_TUPLE_ARITY_MISMATCH` (`GraphBuilder`).
There is one exception: a `BooleanIO` source must feed an input tuple with one
variable (`EDGE_BOOLEAN_TARGET_ARITY`).

You usually do not need to say which source variable fills which target
variable. With no `variableMappings`, the engine pairs variables with equal
names first, and then pairs the rest by position. `?person ?skill` to
`VALUES (?p ?s)` therefore works with no mapping, and a renamed variable on one
side does not change the other pairs.

To choose the pairs yourself, set `variableMappings`: a JSON array of
`{source, target}`, by *variable name*, so it stays correct when IRIs change. It
can be partial. If a target is named twice, only its first mapping counts. A
target with no mapping is `UNDEF` for that row. The engine does not guess a
value for it.

## 3. Build a group on the canvas

The `queryGroups` feature flag controls query groups (`FEATURE_QUERY_GROUPS`,
default on; see [feature flags](../reference/feature-flags.md)). They are in
the rail of the build screen.

1. **Create the group** with the add button of the rail. A new canvas has a
   start node and an end node only. Add nodes from the canvas toolbar:
   *Query*, *Dynamic Query*, *Ruleset*.
2. **Assign a query version.** Select the node, and use *Edit Assignment* in
   the **Editor** tab of the inspector. A collapsed node is mostly its toggle
   button, so click away from the toggle. The assignment creates the ports of
   the node from the declared inputs and outputs of the query version. For a
   rule set node, use *Assign Ruleset* in the same way. For a dynamic node, add
   its *Query ID Input* from the same panel.
3. **Connect.** Drag from a source handle to a target handle. The canvas
   suggests a flow type for the pair (`edge-flow-type-defaults.json`). You can
   change it in the edge inspector. If the ports cannot carry the type you
   choose, the canvas refuses it and shows why.
4. **Map variables** on a bindings edge, in the grid of the edge inspector. It
   shows what the engine does with no mappings (section 2). `city` pairs with
   `city`, and a remaining target gets the first remaining source by position.
   The grid marks that guess with a warning, because a pair by position is
   often wrong. Set the target to a source or to `UNDEF`, and the grid writes
   your choices to the `variableMappings` of the edge.
5. **Save.** The save bar writes a **new version**. Versions are immutable, so
   the version pill moves to the next number.
6. **Run.** The run bar runs the version that you have open. If no version is
   selected, it runs the group, which means its `currentVersion`. The inspector
   changes to its **Results** tab. Each node shows its status, duration, and a
   row or triple count, and the slowest node is marked. A failed node shows the
   reason in its title.

Set parameters in the arguments panel next to the run bar. The signature of the
group comes from what its **start node** declares. `VALUES` blocks in member
queries do not add to it. A saved argument set runs by version id. A scratch set
runs its values inline. The **Code** tab shows the call that Execute would make.

## 4. Build a group over HTTP

### The flat write

There is one way to write the content of a group:

```
POST /query-groups/:id/versions
```

One request carries the whole graph. The parts of a group have no separate write
endpoints, because a second write path would skip the immutability guard and the
`If-Match` check.

The other endpoints:

| Method | Path | Does |
| --- | --- | --- |
| `GET` `POST` | `/query-groups` | list, create the group entity |
| `GET` `PUT` `DELETE` | `/query-groups/:id` | read, update (this sets `currentVersion`), delete |
| `GET` | `/query-groups/:id/versions` | list versions |
| `POST` | `/query-groups/:id/versions` | **create the next version** (flat write) |
| `GET` | `/query-groups/:id/versions/:version` | read one version, expanded |
| `PATCH` | `/query-groups/:id/versions/:version` | annotate (`comment`) or freeze (`immutable: true`, one direction only) |
| `GET` | `/query-groups/:id/versions/:version/validate` | check the structure, without running anything |
| `GET` `POST` | `/query-groups/:id/argument-sets` | the sets that fill the parameters of this group |

### Temporary ids

A payload creates entities that do not exist yet, so it must refer to them
before they have IRIs. An id that starts with `urn:ui-temp:` (`TEMP_ID_PREFIX`)
is a placeholder. The writer replaces it with a new IRI, and the `iriMap` of the
response maps each placeholder to its IRI. Two aliases are reserved:
`urn:__START__` and `urn:__END__` name the start and end nodes, so you do not
need to declare them.

A reference to a `urn:ui-temp:` id that the payload does not declare is an
error. The writer prepares the whole write before it stores anything, and
collects each failure. The request returns `422` with a `references` array that
names each bad field. Nothing is stored. The writer writes the version row last,
so a group version never lists children that do not exist.

### Example: a chain of two nodes

Both query versions already exist. Query 1 selects `?person ?skill`. Query 2
starts with `VALUES (?p ?s) { (UNDEF UNDEF) }`, the all-`UNDEF` row that marks a
parameter slot.

```jsonc
POST /query-groups/urn:sqlib:group:people-skills/versions
{
  "queryGroupVersion": {},
  "endNode": { "mediaType": "application/sparql-results+json" },
  "executionNodes": [
    {
      "id": "urn:ui-temp:node-1",
      "nodeType": "QueryNode",
      "queryId": "<query 1 version IRI>",
      "backendId": "<backend IRI>",
      "outputs": ["<query 1 version inferredOutputs[0]>"]
    },
    {
      "id": "urn:ui-temp:node-2",
      "nodeType": "QueryNode",
      "queryId": "<query 2 version IRI>",
      "backendId": "<backend IRI>",
      "inputs": ["<query 2 version inferredInputs[0]>"],
      "outputs": ["<query 2 version inferredOutputs[0]>"]
    }
  ],
  "edges": [
    {
      "id": "urn:ui-temp:edge-1",
      "sourceNodeId": "urn:__START__",
      "targetNodeId": "urn:ui-temp:node-1",
      "dataFlowType": "CONTROL_FLOW"
    },
    {
      "id": "urn:ui-temp:edge-2",
      "sourceNodeId": "urn:ui-temp:node-1",
      "targetNodeId": "urn:ui-temp:node-2",
      "dataFlowType": "VARIABLE_BINDINGS",
      "sourceOutputId": "<query 1 version inferredOutputs[0]>",
      "targetInputId": "<query 2 version inferredInputs[0]>"
    },
    {
      "id": "urn:ui-temp:edge-3",
      "sourceNodeId": "urn:ui-temp:node-2",
      "targetNodeId": "urn:__END__",
      "dataFlowType": "VARIABLE_BINDINGS",
      "sourceOutputId": "<query 2 version inferredOutputs[0]>",
      "targetInputId": "<query 2 version inferredOutputs[0]>"
    }
  ]
}
```

The response is `201` with the expanded version and `iriMap`. Set it as the
current version of the group (`PUT /query-groups/:id` with `currentVersion`),
and you can run it.

`packages/api/test/scenarios/query-groups/03-select-to-select-chain.test.ts`
builds this group and checks the rows that it returns. Fifteen more scenarios in
the same directory cover parallel branches, diamonds, chains of three nodes,
several end outputs, external parameters, the `whenEmpty` policy and start-node
data graphs. `README-TEST-SCENARIOS.md` in that directory lists them. CI runs
them, so they are the most reliable examples in the repository.

`packages/contracts/src/generated/query-group-version.ts` gives the full write
contract, field by field: `queryGroupVersionForGroupCreateSchema` for writes,
and `queryGroupVersionExpandedSchema` for reads.

## 5. Parameters

### Argument sets

```
POST /execute
{ "targetId": "<group IRI>", "argumentSetIds": ["<argument set version IRI>"] }
```

Or inline, one SPARQL Results JSON document for each parameter to fill:

```jsonc
{
  "targetId": "<group IRI>",
  "arguments": [
    {
      "head": { "vars": ["minPopulation"] },
      "results": { "bindings": [
        { "minPopulation": { "type": "literal", "value": "1000000",
                             "datatype": "http://www.w3.org/2001/XMLSchema#integer" } }
      ] }
    }
  ]
}
```

A group run sends the same argument sets to each node. Each node takes only the
sets whose variables match a `VALUES` group that it declares. The match uses the
set of variables, in any order. Cells are keyed by name, so a table that lists
`[s, p]` fills a `VALUES (?p ?s)` clause, as it does on `/execute` for the query
alone.

Between nodes, an upstream row can have no value in the columns that an edge
maps. An `OPTIONAL` that matched nothing gives such a row. The row carries no
constraint, so sqlib drops it. It does not send it as an all-`UNDEF` row. If
sqlib drops each row, the input is empty, and the `whenEmpty` of the edge
decides. An edge whose variable mapping maps *no* columns is broken, and a run
that reaches it fails with an error that names the edge.

### `whenEmpty`

sqlib rewrites each parameter slot before it sends the query: with bound rows,
with the clause removed, or as a zero-row `VALUES`. When an edge delivers **no**
bound rows, the edge that feeds the slot decides what happens:

| Mode | Rewrite | Means |
| --- | --- | --- |
| `unconstrained` | the `VALUES` clause is removed | optional input: no filter arrived, so do not filter |
| `propagateEmpty` | `VALUES` with zero rows | exact substitution: the empty set arrived, so match nothing |
| `require` | the run fails | the input is mandatory |

If `whenEmpty` is not set, an empty upstream result (zero rows) is
`propagateEmpty`, and a single all-`UNDEF` row is `unconstrained`. sqlib refuses
an all-`UNDEF` row mixed with bound rows.

The `arguments` of a run carry no policy. A caller gives one of two signals by
the form of the argument:

- Leave a slot out: no input arrived. The slot runs `unconstrained`, unless the
  edge says `require`.
- Supply the slot with zero rows: the empty set arrived.

Only the author of the group can set `require`.

### `LIMIT` / `OFFSET`

The expanded response of a group has `limitParameters` and `offsetParameters`.
These are the union of the placeholder names that its member queries declare,
calculated on the server. The fields that the screen offers and the names that
`/execute` accepts are therefore the same. Pass them as `limits` / `offsets`.
Each node receives only the names it declared.

### Data graphs

A start node can declare RDF inputs as well as tuples. Each run fills them:

```jsonc
{
  "targetId": "<group IRI>",
  "dataGraphs": [{ "port": "<port IRI>", "dataGraphVersionId": "<data graph version IRI>" }]
}
```

The other two forms are `dataGraphId` and `dataGraphInline`. The `RDF_GRAPH`
rule in section 2 sets where such a graph can then go.

A single query also takes `dataGraphs`, with a different meaning. A query has no
ports, so the graphs become the whole store it runs over. sqlib loads them into
an ephemeral store for that request, and drops the store after it. Leave
`backendId` out, or name the ephemeral backend. If you name any other backend
with `dataGraphs`, the request gets `400`, because the query would not see that
backend.

## 6. Run a group

```
POST /execute   { "targetId": "<group IRI>" }
```

`targetId` can be the group (it runs `currentVersion`) or a group version. The
response is the result of the end node, with the usual type:
`application/sparql-results+json` for bindings and a boolean, and an RDF media
type for triples (chosen from the `Accept` header and the `mediaType` of the end
node). Two headers say what ran: `X-Resolved-Target` names the version, and
`X-Result-Node` names the node that gave the result.

**Dataset.** Add `defaultGraphs` and/or `namedGraphs` (arrays of IRIs) to run
each query node over those graphs. Without them, a node uses the default
dataset of its backend.

- Leave out both parts to use the default dataset. An empty array means no
  graphs.
- If you give one part and leave out the other, the other part has no graphs.
  This is the rule of SPARQL 1.1 Query §13.2 for `FROM` and `FROM NAMED`.
  Fuseki applies it over HTTP, and sqlib applies it to Oxigraph backends.
- Where a node also has a `DATASET` edge, sqlib intersects the two limits for
  each part. A part you leave out does not limit the edge's part. A caller can
  narrow the choice of the group author, but cannot widen it.
- For an UPDATE, the dataset sets the graphs that its `WHERE` clause reads, as
  `USING` and `USING NAMED` do. It does not change the graphs the update writes
  to. Over HTTP, sqlib sends it as the `using-graph-uri` and
  `using-named-graph-uri` parameters (SPARQL 1.1 Protocol §2.2.3). sqlib does
  not change the update text.
- An in-process Oxigraph backend applies an update dataset only when its
  binding supports the dataset options of `Store.update`. sqlib tests this
  once at load. Oxigraph 0.5.13 does not support them, so sqlib refuses the
  update with `400` and code `UPDATE_DATASET_UNSUPPORTED`. Run the update
  without a dataset, or use an HTTP backend.
- sqlib refuses with `400` a dataset on an UPDATE whose text has `USING`,
  `USING NAMED` or `WITH`, as the protocol requires (code
  `UPDATE_DATASET_CONFLICT`). It also refuses a dataset on `DELETE WHERE`
  (code `UPDATE_DATASET_DELETE_WHERE`), because backends do not agree on what
  it reads. Write it as `DELETE { … } WHERE { … }`.
- `POST /patches/preview` takes the same two fields. The patch stores the
  dataset, and an apply derives the patch again over the same graphs.
- `POST /sparql` takes the same two fields. `GET /sparql` takes the protocol
  parameters `default-graph-uri` and `named-graph-uri`, once for each graph.

**Detail for each node.** Add `nodeDetail: "timings"` or
`nodeDetail: "results"`, and the response becomes a JSON envelope, whatever the
type of the result:

```jsonc
{ "result": …, "nodes": [ { "nodeId": …, "status": …, "durationMs": …, … } ],
  "resultContentType": "application/n-triples" }
```

The `Content-Type` of the response describes the envelope. `resultContentType`
tells a client the type of the result *inside* it. The group screen sets
`nodeDetail: "results"` on each run.

**Failure.** A node that throws an error fails the run with `400`. The body
names the node: `error`, `failedNodeId`, `failedNodeName`, and `nodes` if you
asked for node detail. The canvas marks that node from `failedNodeId`, also when
the node reported no status of its own.

**Validation before a run.** `GET /query-groups/:id/versions/:version/validate`
returns `{ errors, warnings, issues }`. Each issue has a stable `code`, an
`entityType` and an `entityId`, so a client can mark the node or edge with the
problem without parsing a message. The codes are the enum in
`packages/api/src/lib/orchestration/GraphValidationError.ts`, in these groups:

- Shape of the whole graph: `GRAPH_CYCLE`, `GRAPH_NO_EXECUTABLE_NODE`,
  `END_NODE_MIXED_RESULT_TYPES`, `END_NODE_NO_DATA_INPUT`.
- Edge connections: `EDGE_FLOW_TYPE_UNSUPPORTED`, `EDGE_CONTROL_FLOW_HAS_IO`,
  `EDGE_DATA_FLOW_MISSING_IO`, …
- Port compatibility: `EDGE_SOURCE_PORT_TYPE`, `EDGE_QUERY_ID_ARITY`,
  `EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME`, …
- Tuple shape.
- Agreement between a node and its query: `NODE_VALUES_GROUP_MISSING`,
  `NODE_RULESET_INBOUND_FLOW_TYPE`, …

## 7. Versions

A query group version is an immutable snapshot. `POST …/versions` creates the
next version, and is the only way to write content. `PATCH …/versions/:version`
accepts a `comment` and `immutable: true` (never `false`), and enforces
`If-Match`. A run by the group IRI runs the version that `currentVersion` names,
so to promote a version, send a `PUT` on the group.

For this reason, Save on the canvas never overwrites. Each edit that reaches the
server is a new version, and the version pill shows which version you are
looking at.

## 8. Known limits

- **Sequential execution.** Parallel DAG branches run one after another.
  Nothing runs at the same time.
- **An end node with several data inputs merges RDF only.** With one
  predecessor, the end node returns its result as it is. With several RDF
  predecessors, it concatenates them. Bindings or booleans from more than one
  predecessor fail the run with "Support for merging bindings/booleans is not
  yet implemented" (`ExecutionEngine`). Validation refuses mixed result types
  earlier, as `END_NODE_MIXED_RESULT_TYPES`.
- **`DuckDbEtlNode` in a group** cannot be created. See section 2.
- **The rows of a node are fetched, but not shown.** `nodeDetail: "results"`
  parses the result of each node, and the canvas shows only status, duration
  and counts.
- **Visual regression tests of canvas states** run locally only (`@visual`).
  CI excludes them, so a developer reviews changes to canvas rendering on their
  own machine.

## 9. Further reading

- `packages/api/test/scenarios/query-groups/`: sixteen executable examples,
  listed in `README-TEST-SCENARIOS.md` in that directory.
- `packages/contracts/src/generated/query-group-version.ts`: the write and read
  contracts, field by field.
- [Running and configuring](running-and-configuring.md): start a server with
  query groups on.
- [Authoring and running rules](rules-and-srl.md): what a rule set node runs.
