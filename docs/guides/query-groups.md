# Query groups: chaining queries

A query group runs several callables in dependency order and passes results
between them. This guide covers what a group is, how to author one on the
canvas, how to build and run one over HTTP, and where the edges are.

## 1. What a query group is

A **query** runs one SPARQL string against one store. A **query group** runs
several callables in dependency order and passes results between them: the rows
one node returns become the `VALUES` rows the next node runs with, an RDF graph
one node builds becomes the graph a rule set reasons over, and one node's single
column can even name *which query* the next node runs.

A group is a DAG. You wire the data rather than writing an order: the engine
takes the nodes in topological order (Kahn, `ExecutionEngine.execute`) and runs
them one at a time. Execution is sequential, so parallel branches — a legal DAG
shape — are executed one after another. That is a performance property rather
than a semantic one.

Reach for a group when:

- a query needs rows a *different* store or query produced;
- a pipeline is worth saving, versioning and re-running as one unit;
- rules need to run over a graph that a `CONSTRUCT` builds first;
- the same shape should run with different parameters (an argument set).

Reach for something else when a single parameterised query would do — a group's
smallest useful form is still four entities and three edges.

## 2. The moving parts

### Nodes

| Kind | Runs | Gets its work from |
| --- | --- | --- |
| **Start node** | nothing | The group's own inputs: it *is* the boundary. One per group, minted for you. |
| **Query node** (`QueryNode`) | one query version against one backend | `queryId` (a query version IRI) + `backendId` |
| **Dynamic query node** (`DynamicQueryNode`) | a query version chosen at run time | a `QueryIdInput` port fed by a `QUERY_ID` edge |
| **Rule set node** (`RuleSetNode`) | a rule set, in process, over the RDF handed to it | `ruleSetVersion` |
| **End node** | nothing | The group's result: whichever node's output is wired into it. |

Start and End are canvas nodes but not executable ones — the engine treats them
as control-flow markers, seeding the start node's declared outputs from what the
caller supplied and reading the group's result off the end node's inputs.

`DuckDbEtlNode` exists in the schemas and the engine, but nothing can create
one: the flat writer mints `QueryNode`, `DynamicQueryNode` and `RuleSetNode`
and nothing else (`GroupVersionWriter.ts`). ETL pipelines are their own rail,
outside query groups.

### Ports

A node does not connect to a node — a *port* connects to a port. Ports are
first-class entities, and which kind you have decides which edges are legal:

- `QueryInputTuple` / `QueryOutputTuple` — an ordered list of variables (its
  `TupleMember`s carry `position`), the shape SELECT rows travel in.
- `TriplesQuadsIO` — an RDF graph, in or out.
- `BooleanIO` — an ASK answer.
- `QueryIdInput` — the one port only a dynamic query node has.

For a query node you rarely declare ports by hand: the writer merges the query
version's `inferredInputs` / `inferredOutputs` into whatever the payload names,
so assigning a query version is what gives a node its ports. A rule set node
gets one `TriplesQuadsIO` in each direction from its assignment.

An input tuple belongs to the *query version*, not to the group — every group
using that query shares it. That is why a per-edge policy like `whenEmpty` lives
on the edge (§5) rather than on the port.

### Edges and flow types

`packages/api/src/lib/orchestration/types.ts` defines five:

| `dataFlowType` | Carries | Legal between |
| --- | --- | --- |
| `CONTROL_FLOW` | nothing — ordering only | any two nodes; the edge must name no ports |
| `VARIABLE_BINDINGS` | SELECT rows | output tuple → input tuple |
| `RDF_GRAPH` | triples/quads | `TriplesQuadsIO` → `TriplesQuadsIO` |
| `BOOLEAN` | an ASK answer | `BooleanIO` → `BooleanIO` |
| `QUERY_ID` | a one-column tuple naming a query version | output tuple (arity 1) → a dynamic node's `QueryIdInput` |

Two rules about `RDF_GRAPH` are worth knowing before you draw one, because both
are refused rather than silently ignored (`GraphBuilder.validateGraph`):

- A rule set node and the end node can be handed RDF directly.
- A **SPARQL** node cannot — a query runs against a store, so RDF only reaches
  one if it is materialized into an ephemeral store that node also queries.
  Without an ephemeral `backendConfig` on the right node, the edge is rejected
  with `EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME` rather than transferring nothing
  and letting the node quietly query its own backend.

A `VARIABLE_BINDINGS` edge between two tuples must have **equal arity** — the
validator refuses anything else with `EDGE_TUPLE_ARITY_MISMATCH`
(`GraphBuilder`). The one exception is a `BooleanIO`
source, which must feed a one-variable input tuple
(`EDGE_BOOLEAN_TARGET_ARITY`).

*Which* source variable fills *which* target variable is a separate question,
and you usually do not have to answer it. With no `variableMappings` the engine
pairs same-named variables first and then the leftovers by position — so
`?person ?skill` → `VALUES (?p ?s)` works untouched, and a rename on one side
does not shuffle the rest. Set `variableMappings` (a JSON array of
`{source, target}`, by *variable name* so it survives IRI remapping) to choose
the pairing yourself; it may be partial, and a target named twice keeps only its
first mapping. A target left unmapped is `UNDEF` for that row rather than
guessed at.

## 3. Authoring one on the canvas

Query groups live behind the `queryGroups` feature flag
(`FEATURE_QUERY_GROUPS`, default on — see
[feature flags](../reference/feature-flags.md)), in the build screen's rail.

1. **Create the group** from the rail's add button. A fresh canvas is a start
   node and an end node and nothing else — the boundary, waiting for a middle.
   Add nodes from the canvas toolbar: *Query*, *Dynamic Query*, *Ruleset*.
2. **Assign a query version.** Select the node (click clear of its toggle — a
   collapsed node is mostly its own toggle button) and use *Edit Assignment* in
   the inspector's **Editor** tab. The assignment mints the node's ports from
   the query version's declared inputs and outputs. A rule set node takes
   *Assign Ruleset* the same way, and a dynamic node adds its one *Query ID
   Input* from the same panel.
3. **Connect.** Drag from a source handle to a target handle. The canvas
   recommends a flow type for the pair (`edge-flow-type-defaults.json`) and you
   can override it in the edge inspector — an override the endpoints cannot
   carry is refused, visibly, rather than applied.
4. **Map variables** on a bindings edge, in the edge inspector's grid. It
   defaults by name — `city` pairs itself, and a target-only `region` is left
   `UNDEF` rather than guessed at — and writes your choices out as the edge's
   `variableMappings`. An edge with no mappings at all is paired by the engine
   instead (§2).
5. **Save.** The save bar writes a **new version** — versions are immutable
   snapshots, so there is no in-place edit and the version pill advances.
6. **Run.** The run bar runs the version you have open, falling back to the
   group itself — and so to its `currentVersion` — when none is selected; the inspector
   switches to its **Results** tab, each node shows status, duration and a row
   or triple count, and the slowest node is marked. A failed node carries its
   reason in its title.

Parameters are authored in the arguments panel beside the run bar: the group's
signature comes from what its **start node** declares, not from `VALUES` blocks
detected in member queries. A saved argument set runs by version id; a scratch
one runs its values inline. The **Code** tab shows whichever call Execute would
make.

## 4. Building one over HTTP

### The flat write

There is exactly one way to write a group's content:

```
POST /query-groups/:id/v
```

One request carries the whole graph. There are no incremental write endpoints
for a group's parts: a second write path would skip the immutability guard and
the `If-Match` check.

The other endpoints:

| Method | Path | Does |
| --- | --- | --- |
| `GET` `POST` | `/query-groups` | list, create the group entity |
| `GET` `PUT` `DELETE` | `/query-groups/:id` | read, update (this is how `currentVersion` is set), delete |
| `GET` | `/query-groups/:id/v` | list versions |
| `POST` | `/query-groups/:id/v` | **create the next version** (flat write) |
| `GET` | `/query-groups/:id/v/:version` | read one version, expanded |
| `PATCH` | `/query-groups/:id/v/:version` | annotate (`comment`) or freeze (`immutable: true`, one direction only) |
| `GET` | `/query-groups/:id/v/:version/validate` | structural check, without running anything |
| `GET` `POST` | `/query-groups/:id/argument-sets` | the sets that fill this group's parameters |

### Temporary ids

A payload mints entities that do not exist yet, so it needs to refer to them
before they have IRIs. Any id beginning `urn:ui-temp:` (`TEMP_ID_PREFIX`) is a
placeholder the writer replaces with a minted IRI, and the response's `iriMap`
maps every placeholder to what it became. Two aliases are reserved:
`urn:__START__` and `urn:__END__` name the start and end nodes without your
having to declare them.

Referring to a `urn:ui-temp:` id that nothing in the payload declares is an
error, not a silent skip: the write is staged in full before anything is
written, every failure is accumulated, and the request comes back `422` with a
`references` array naming each bad field. Nothing partial is stored — the
version row is written last, so a group version never lists children that do not
exist.

### A worked two-node chain

Both query versions already exist. Query 1 selects `?person ?skill`; query 2
opens with `VALUES (?p ?s) { (UNDEF UNDEF) }` — the reserved all-`UNDEF` row that
marks a parameter slot.

```jsonc
POST /query-groups/urn:sqlib:group:people-skills/v
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

`201` comes back with the expanded version plus `iriMap`. Point the group at it
(`PUT /query-groups/:id` with `currentVersion`) and it is runnable.

This is not an invented example: it is
`packages/api/test/scenarios/query-groups/03-select-to-select-chain.test.ts`,
which builds exactly this and asserts the rows come back. Fifteen further
scenarios beside it cover parallel branches, diamonds, three-node chains,
multiple end outputs, external parameters, the `whenEmpty` policy and start-node
data graphs — `README-TEST-SCENARIOS.md` in that directory is the index, and
they are the most reliable examples in the repository because CI runs them.

The full write contract, field by field, is
`packages/contracts/src/generated/query-group-version.ts`
(`queryGroupVersionForGroupCreateSchema` for writes,
`queryGroupVersionExpandedSchema` for reads).

## 5. Parameters

### Argument sets

```
POST /execute
{ "targetId": "<group IRI>", "argumentSetIds": ["<argument set version IRI>"] }
```

or inline, as SPARQL-Results-shaped rows:

```jsonc
{
  "targetId": "<group IRI>",
  "arguments": [
    {
      "head": { "vars": ["minPopulation"] },
      "arguments": { "bindings": [
        { "minPopulation": { "type": "literal", "value": "1000000",
                             "datatype": "http://www.w3.org/2001/XMLSchema#integer" } }
      ] }
    }
  ]
}
```

A group's run carries the same argument sets to every node, and each node takes
only the ones whose variable list matches a `VALUES` group it actually declares.
A set matching a slot's *length* but not its *order* is a hard error, not a
silent mis-binding:

```
Argument variable order mismatch for VALUES input [p, s]; received [s, p].
```

### `whenEmpty`

Every parameter slot is rewritten before dispatch — bound rows, clause removed,
or a zero-row `VALUES`. What happens when an input supplies **no** bound rows is
the one genuine choice, and it is a property of the edge that feeds the slot:

| Mode | Rewrite | Means |
| --- | --- | --- |
| `unconstrained` | the `VALUES` clause is removed | optional enrichment: no filter arrived, so do not filter |
| `propagateEmpty` | `VALUES` with zero rows | faithful substitution: the empty set arrived, so match nothing |
| `require` | the run fails | this input is mandatory |

The defaults, unset (`parser.ts`): an **empty set that arrived**
(zero rows) is `propagateEmpty`; **nothing arriving at all** — an absent external
parameter, or the pure singleton wildcard row — is `unconstrained`. An
all-`UNDEF` row mixed with bound rows is rejected outright.

### `LIMIT` / `OFFSET`

A group's expanded response carries `limitParameters` and `offsetParameters`:
the union of the placeholder names its member queries declare, computed
server-side so the fields the screen offers and the names `/execute` accepts
cannot disagree. Pass them as `limits` / `offsets`; each node receives only the
names it declared.

### Data graphs

A start node can declare RDF inputs as well as tuples, filled per run:

```jsonc
{
  "targetId": "<group IRI>",
  "dataGraphs": [{ "port": "<port IRI>", "dataGraphVersionId": "<data graph version IRI>" }]
}
```

`dataGraphId` and `dataGraphInline` are the other two forms. `dataGraphs` is
accepted for a query group only — on any other target it is a `400`, because
nothing else declares the ports it fills. Where such a graph may then flow is
the `RDF_GRAPH` rule in §2.

## 6. Running one

```
POST /execute   { "targetId": "<group IRI>" }
```

`targetId` may be the group (it runs `currentVersion`) or a group version
directly. The response is the end node's result, typed the ordinary way:
`application/sparql-results+json` for bindings and a boolean, an RDF media type
for triples (negotiated from the `Accept` header and the end node's
`mediaType`). Two headers say what actually ran: `X-Resolved-Target` names the
version, `X-Result-Node` the node the result came from.

**Per-node detail.** Add `nodeDetail: "timings"` or `nodeDetail: "results"` and
the reply becomes a JSON envelope whatever the result's own type:

```jsonc
{ "result": …, "nodes": [ { "nodeId": …, "status": …, "durationMs": …, … } ],
  "resultContentType": "application/n-triples" }
```

The envelope's own `Content-Type` describes the envelope, so `resultContentType`
is how a client knows what is *inside* it. The group screen sets
`nodeDetail: "results"` on every run.

**Failure.** A node that throws fails the run with `400`, and the body names the
node — `error`, `failedNodeId`, `failedNodeName`, plus `nodes` if node detail was
asked for. The canvas marks that node from `failedNodeId` even when the node
never reported a status of its own.

**Validation before running.** `GET /query-groups/:id/v/:version/validate`
returns `{ errors, warnings, issues }`, each issue carrying a stable `code`, an
`entityType` and an `entityId` so a client can highlight the offending node or
edge rather than parse prose. The codes are the enum in
`packages/api/src/lib/orchestration/GraphValidationError.ts`, grouped as:
whole-graph shape (`GRAPH_CYCLE`, `GRAPH_NO_EXECUTABLE_NODE`,
`END_NODE_MIXED_RESULT_TYPES`, `END_NODE_NO_DATA_INPUT`), edge wiring
(`EDGE_FLOW_TYPE_UNSUPPORTED`, `EDGE_CONTROL_FLOW_HAS_IO`,
`EDGE_DATA_FLOW_MISSING_IO`, …), port compatibility (`EDGE_SOURCE_PORT_TYPE`,
`EDGE_QUERY_ID_ARITY`, `EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME`, …), tuple shape,
and node/query agreement (`NODE_VALUES_GROUP_MISSING`,
`NODE_RULESET_INBOUND_FLOW_TYPE`, …).

## 7. Versions

A query group version is an immutable snapshot. `POST …/v` mints the next one
and is the only way to write content; `PATCH …/v/:version` accepts a `comment`
and `immutable: true` (never `false`), and enforces `If-Match`. Running a group
by its group IRI runs whatever `currentVersion` points at, so promoting a
version is a `PUT` on the group.

This is why the canvas has no "save" that overwrites: every edit that reaches
the server is a new version, and the version pill is the honest indicator of
which one you are looking at.

## 8. Known edges

- **Sequential execution.** Parallel DAG branches run one after another;
  nothing executes concurrently.
- **An end node with several data inputs merges RDF only.** One predecessor
  returns its result as-is; several RDF predecessors are concatenated;
  bindings or booleans from more than one predecessor fail the run with
  "Support for merging bindings/booleans is not yet implemented"
  (`ExecutionEngine`). Mixed result types are refused earlier, at validation,
  as `END_NODE_MIXED_RESULT_TYPES`.
- **`DuckDbEtlNode` in a group** is unreachable — see §2.
- **A node's own rows are fetched and not shown.** `nodeDetail: "results"`
  parses each node's result and the canvas displays status, duration and counts
  only; the rows themselves are not shown anywhere.
- **Visual regression on canvas states** is a local gate (`@visual`), excluded
  from CI, so canvas rendering changes are reviewed on a developer machine.

## 9. Further reading

- `packages/api/test/scenarios/query-groups/` — sixteen executable examples,
  indexed by `README-TEST-SCENARIOS.md` in that directory.
- `packages/contracts/src/generated/query-group-version.ts` — the write and read
  contracts, field by field.
- [Running and configuring](running-and-configuring.md) — starting a server with
  query groups enabled.
- [Authoring and running rules](rules-and-srl.md) — what a rule set node runs.
