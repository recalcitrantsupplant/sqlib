# Required arguments

Status: implemented. The run bar marker is deferred (see the end).

## Decision

A query author can mark a parameter slot so that it never runs open. The mark
is metadata on the slot's input tuple (`QueryInputTuple`). It is not in the
query text.

The mark reuses the existing `whenEmpty` mode:

| `whenEmpty` on the tuple | Slot omitted, or one all-`UNDEF` row | Zero rows |
| --- | --- | --- |
| unset (default) | Runs open, as today | Matches nothing, as today |
| `unconstrained` | Runs open | Runs open |
| `propagateEmpty` | Matches nothing | Matches nothing |
| `require` | Refused, 400 | Refused, 400 |

`require` is the guard. `propagateEmpty` is a quieter guard: the run is cheap
and returns no rows.

A slot with rows is never changed by this mark. The mark acts only when the
input supplies no bound rows.

## Why

A slot is declared as `VALUES ?x { UNDEF }`. When a caller omits it, the
runtime removes the block (`completeArgumentSets` in
`packages/runtime/src/query-template.ts`). The query then runs with `?x` open.

For some queries an open run is a mistake. A test of an `isPartOf` lookup ran
with no argument. It walked every `isPartOf` link in the graph and hit the
60 s limit. The test did not show real use. The author knew the query needs a
start node, but the query had no way to say so.

### Why not `FILTER(BOUND(?x))`

It does not stop the work, and it does not detect the omission.

- When the slot is omitted, the block is removed. The triple pattern binds
  `?x` on every solution, so `BOUND(?x)` is always true.
- A filter applies to the solutions of its group. The engine matches the
  pattern first, so the expensive walk runs before the filter.
- The query text cannot see if the caller supplied a value. Only the runtime
  knows that.

### Why not a backend or grant policy

A policy such as "no open slots on this backend" is too coarse. Some queries
must run open, for example a "list all" query with an optional filter slot.
Whether a slot may run open is a fact about the query, so the query author
sets it.

Cost control is a separate concern. It stays with the execution deadline
(`SQLIB_EXECUTION_TIMEOUT_MS`) and backend timeouts. The guard records intent.
It does not limit cost.

### Why metadata and not a text marker

- The query text stays plain SPARQL. Other tools can run it.
- `whenEmpty` already exists, with the same three modes, on query-group edges
  and in the export bundle. The slot uses the same words.

The cost: an ad-hoc run of unsaved text (`POST /sparql`) has no tuple, so it
has no guard. That is acceptable. The editor shows the text, and the person
who runs it sees what they omit.

## Rows in a multi-variable slot

A slot can declare more than one variable: `VALUES (?x ?y) { (UNDEF UNDEF) }`.

The rule today, which this proposal keeps:

- Each row must bind at least one variable. A row that binds nothing is
  allowed only as the single row of the set. That single all-`UNDEF` row is
  the wildcard, and it means "no argument". A wildcard row mixed with bound
  rows is refused.
- A row can leave some variables `UNDEF`, for example `(ex:a UNDEF)`. That row
  constrains `?x` and leaves `?y` open.

So for a `require` slot: the set must have at least one row, and each row binds
at least one of the variables. The guard does not check each variable. A row
`(ex:a UNDEF)` passes, even if the expensive variable is `?y`.

If a query needs `?y` bound in every row, put `?y` in its own slot and mark
that slot `require`. A per-variable guard is deferred (see below).

## Precedence

When more than one source sets `whenEmpty` for a slot, the most specific one
applies:

1. The query-group edge that feeds the slot (`QueryEdge.whenEmpty`). The group
   author decides what an empty upstream result means for this hop.
2. The slot's tuple (`QueryInputTuple.whenEmpty`). The query author decides
   what "no argument" means for the query.
3. The built-in default: an omitted slot or a wildcard row runs open. Zero rows
   match nothing.

One limit applies to item 1. An edge cannot set `unconstrained` on a `require`
or `propagateEmpty` slot, because that removes the query author's guard. Group
save refuses such an edge, and the run refuses it too.

A request on the wire carries rows only, never a mode. This is the same as
today.

## Where it changes

### Storage

- `QueryInputTupleSchema`: add optional `whenEmpty`, with the
  `WHEN_EMPTY_MODES` values from `QueryEdgeSchema.ts`.
- A version is immutable, and its tuples belong to it. So the mark changes only
  with a new version.
- `POST /queries/:id/versions` accepts an optional top-level list
  `inputPolicies: [{ vars: ["x"], whenEmpty: "require" }]`, matched to slots
  by variable set, as argument sets are matched. `whenEmpty: null` clears a
  mode. A policy that names no declared slot is refused with 400. (The name is
  not `inputs`, because that field already carries the input variables.)
- For a slot the body does not name, `QueryVersionWriter` copies `whenEmpty`
  from the previous current version's tuple with the same variable set. A text
  edit then keeps the guard.

### Runtime

- `completeArgumentSets(slotVars, sets, slotPolicies?)` takes the policies as
  `{ vars, whenEmpty }`.
  It puts the slot's mode on each set that has no `whenEmpty` of its own, and
  on the set it creates for an omitted slot.
- `applyTemplateArguments` and the compiler's AST `applyArguments` both call
  `completeArgumentSets` already. So both paths get the guard from one change.
  The differential suite in `parser.template-equivalence.test.ts` covers it.
- The refusal names the slot by its variables:
  `Required input for VALUES clause 1 (?node) received no bindings.`
  The route answers 400.

### Callers

- `/execute`, test cases, benchmarks and `invokeCallable`: pass the version's
  slot modes to the parser.
- `ExecutionEngine`: an omitted slot uses
  `declaredWhenEmpty ?? slotWhenEmpty ?? 'unconstrained'` in place of
  `declaredWhenEmpty ?? 'unconstrained'`.
- Export bundle: add optional `inputPolicies: { vars, whenEmpty }[]` to
  `ExportedQuery`. Older bundles have no field and keep today's behaviour, so
  bundle `version` stays 1. The group walk leaves an unfilled slot out, so the
  query's policy applies there too.
- MCP: `queries_get` and the version tools show the mode on each input.
  `detection_detectInputs` reads text only, so it does not report the mode.

### Web

- The Details tab of the query editor gets one control per slot, under "If a
  parameter gets no value". The labels are the ones the group edge editor uses.
  A change is saved with the next version, like an edit to the text, and Save
  sends the mode of every slot.

## Example

```sparql
PREFIX dcterms: <http://purl.org/dc/terms/>
SELECT ?part WHERE {
  VALUES ?whole { UNDEF }
  ?part dcterms:isPartOf+ ?whole .
}
```

With the slot `[?whole]` marked `require`:

| Call | Result |
| --- | --- |
| `arguments: []` | 400: requires an argument for `[?whole]` |
| `?whole` = one all-`UNDEF` row | 400, same message |
| `?whole` = zero rows | 400, same message |
| `?whole` = `ex:book1` | Runs, constrained to `ex:book1` |

## Deferred

- **Run bar marker.** Mark a `require` slot in the run bar, and disable Run
  while it is empty. The server refusal is clear, so this waits.

- **Per-variable guard.** Require each named variable to be bound in every row
  of a multi-variable slot. Wait for a real query that needs it.
- **Backend default.** A backend or grant that treats every unmarked slot as
  `propagateEmpty`. Add it only if a deployment asks for it.
- **Constant slots.** The constant proposal (`?000word`) already requires
  exactly one bound row, so a constant slot is required by design. It needs no
  mark.
