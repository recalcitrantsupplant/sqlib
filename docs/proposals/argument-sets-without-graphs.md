# Argument sets without graphs

Status: accepted. Implemented with [browser defaults](browser-defaults.md).

## Decision

An argument set holds values for SPARQL parameters only: one table per
`VALUES` clause and one number per named `LIMIT` or `OFFSET`. It holds no data
graphs.

A data graph is a separate input. A rule set takes one. A query group takes
one per start-node data graph input. A run sends them in `dataGraphs[]`, and
nowhere else.

`ArgumentGraphBinding` is removed. There is no migration: sqlib is pre-1.0,
and stored graph bindings are dropped.

## Why

Before this change, an `ArgumentSetVersion` could hold `ArgumentGraphBinding`s,
one per start-node graph input of a query group. That made an argument set
"everything one call takes" for a group, but not for anything else:

| Callable | Took argument sets | Took data graphs | Graphs inside argument sets |
| --- | --- | --- | --- |
| Query | Yes | No | Dead weight. The signature check ignored them and the run dropped them |
| Rule set | No | Yes, one | Not possible. A rule set takes no argument set |
| Query group | Yes | Yes | Yes, as a second way to send them |

Four problems followed:

1. **Two ways to send a group's graphs.** `/execute` took `dataGraphs[]` and
   also read graphs from the named sets. It concatenated the two lists and
   needed a slot-conflict check between them.
2. **Tests already split them.** A group test names a data graph per case and an
   argument set separately (the subject-kinds table in
   `reference/entity-model.md`). Only the argument set model mixed them.
3. **The signature check could not see graphs.** `argumentSignature.ts`
   ignored `graphBindings`, so a set with graphs offered to a query said
   `fits` and the run dropped the graphs with no message.
4. **"Data graph" meant two things.** For a rule set it was a separate input.
   For a group it was an argument. A data graph input on a group feeds a rule set
   node or a node's in-memory store, so it is the same kind of input in both
   places.

After this change, the inputs are uniform:

| Callable | Argument set | Data graphs |
| --- | --- | --- |
| Query | Optional, one or more composed | None. Its store is its backend |
| Rule set | None | One |
| Query group | Optional, one or more composed | One per start-node data graph input, by position |

## What changes

### API

- `ArgumentGraphBinding` is deleted: the schema, registry entries, id prefix
  and the `graphBindings` property on `ArgumentSetVersion`.
- `POST /argument-sets` and `POST /argument-sets/:id/versions` refuse a
  `graphBindings` field, through the request schema.
- `ArgumentSetService.exportRuntimePayload` returns no `dataGraphs`.
- `/execute` reads a group's graphs from `dataGraphs[]` only. The merge and the
  slot-conflict check go.
- `lib/dataGraphPins.ts` is deleted. Its only pin holders were graph bindings,
  so a data graph delete no longer has argument sets to refuse on.
- `graphParameterKey` and the `graph` parameter kind leave
  `@sparql-query-lib/types`.

### Web

- The argument set editor has no graph section.
- The query group screen has a separate **Data graphs** picker, one row per
  start-node data graph input. A run sends its picks as `dataGraphs[]`.
- A group test already takes data graphs per case, so the test screen only
  loses the graph rows that came from an argument set.

### Pasted RDF

`inline-inputs-and-the-rail.md` made pasted RDF in a saved argument set a
create-then-pin: saving minted a `DataGraph`. With no graphs in argument sets,
that path goes. Pasting RDF into a group run is still transport, as before
("running is not saving"). To keep the graph, save it as a data graph from the
picker, the same way the rule set screen does.
