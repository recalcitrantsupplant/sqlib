# RDF Patch: what an update would do

`@sparql-query-lib/rdf-delta` calculates what a SPARQL update would add and
remove, without running it.

```ts
import { derivePatch, oxigraphDeltaStore, patchToRdfPatch } from '@sparql-query-lib/rdf-delta';

const patch = await derivePatch(
  'DELETE { ?s :status "draft" } INSERT { ?s :status "live" } WHERE { ?s :status "draft" }',
  oxigraphDeltaStore(store),
);

patch.deletionCount; // 3
patch.additionCount; // 3
patchToRdfPatch(patch);
```

You can use the result as a preview, an audit record, an undo (apply the
inverse) and a replication unit.

## Why two CONSTRUCTs give the exact result

SPARQL Update fills the DELETE and INSERT templates against the state of the
graph store *before* the operation. `CONSTRUCT { D } WHERE { W }` and
`CONSTRUCT { I } WHERE { W }`, evaluated against the current store, are
therefore exactly what `DELETE { D } INSERT { I } WHERE { W }` would delete and
insert. Two read-only queries give the exact ground delta.

The result can differ from the real update in three known cases. sqlib reports
each case on the patch, and keeps it out of the counts:

- A graph-management operation whose contents were counted and not listed.
- A `LOAD`, whose document is outside the dataset.
- A store that cannot answer whether it holds a quad that contains a blank node.

For each form, the rewrite is:

| Update form | Deletions come from | Additions come from |
| --- | --- | --- |
| `INSERT DATA { G }` | none | `G`, already ground; no query needed |
| `DELETE DATA { G }` | `G`, filtered to the triples that are present | none |
| `DELETE { D } WHERE { W }`, `DELETE WHERE { P }` | `CONSTRUCT { D } WHERE { W }` (for the short form, `D = W = P`) | none |
| `INSERT { I } WHERE { W }` | none | `CONSTRUCT { I } WHERE { W }` |
| `DELETE { D } INSERT { I } WHERE { W }` | `CONSTRUCT { D } WHERE { W }` | `CONSTRUCT { I } WHERE { W }` |

`USING` and `USING NAMED` become the `FROM` / `FROM NAMED` dataset clause of the
CONSTRUCT. `WITH` becomes a `GRAPH` wrapper.

CONSTRUCT produces triples, and a patch needs quads. sqlib therefore splits a
template that contains `GRAPH` blocks by graph. The default-graph part and each
`GRAPH g { … }` block become separate CONSTRUCTs with the same WHERE. The
assembler adds the graph to each result set, then merges them.

Against an Oxigraph store in the same process, the derivation uses no SPARQL
text. It evaluates the WHERE clause once, and fills the templates from the
solution sequence in JavaScript. This path is exact and fast. The test suite
uses it as the reference implementation.

## Net effect

The raw template results are larger than the real change. A delete of an absent
triple does nothing. So does an insert of a triple that is already present. A
triple that the same operation deletes and inserts again stays in the store. If
`S` is the store and `D*` / `I*` are the filled templates, the state after the
update is `S' = (S \ D*) ∪ I*`. The net patch is therefore:

```
deletions = (S ∩ D*) \ I*
additions = I* \ S
```

The raw counts are kept as `rawDeleteCount` and `rawInsertCount`. A preview can
then show, for example, that you asked to delete 12 triples and 9 of them
existed.

These set operations run in the process that calculates the patch. Both
CONSTRUCT results become quad arrays, and the membership tests against the store
are sent in batches of existence queries. Membership uses RDF term equality on
parsed terms. `:rel` and `<http://…/rel>` are the same IRI, and a comparison of
source text would count them as two.

## What it covers

| Form | Supported |
| --- | --- |
| `INSERT DATA`, `DELETE DATA` | yes |
| `DELETE WHERE` | yes |
| `INSERT … WHERE`, `DELETE … WHERE`, `DELETE … INSERT … WHERE` | yes |
| `WITH`, `USING`, `USING NAMED` | yes |
| `GRAPH <g>` and `GRAPH ?var` in templates | yes |
| Programs of several operations, each one ground | yes |
| Programs of several operations, where one reads what another wrote | yes, on a store that can `fork` |
| `CLEAR`, `DROP`, `COPY`, `MOVE`, `ADD` | counted; exact with `enumerateGraphOps` |
| `CREATE` | yes; it moves no triples |
| `LOAD` | recorded, never calculated |

An unsupported form throws `UnsupportedUpdateError`, which names the operation.
sqlib gives no preview where it cannot give a correct one.

### Graph-management operations

`CLEAR GRAPH <g>` names a graph. To find the triples in that graph is a separate
query, with its own cost. By default, sqlib therefore counts them with one
`SELECT (COUNT(*) …)`, and the patch states that its quads are not the whole
update:

```ts
const patch = await derivePatch('DROP GRAPH <http://ex/g>', store);
patch.graphOps;   // [{ form: 'drop', destination: {…}, affectedCount: 4200, enumerated: false }]
patch.applyMode;  // 'graph-ops': a preview and an audit record, which cannot be applied as a diff
patch.revertible; // false
```

With `enumerateGraphOps`, the operation becomes ordinary quads. They go through
the same net-effect calculation as other forms, so you can apply, revert and
hash the patch. `enumerationCap` sets a limit. Above the limit, sqlib throws
`EnumerationCapExceededError` with the size it would have listed.

```ts
await derivePatch('DROP GRAPH <http://ex/g>', store, {
  enumerateGraphOps: true,
  enumerationCap: 10_000,
});
```

No option helps with `LOAD`. Its document is outside the dataset, so no query
against the store can show its contents.

sqlib keeps the `graphOps` records also when it lists the quads. A record that
quads were removed because their graph was dropped is a different fact from a
record that they were deleted. An empty graph that was created or removed leaves
no quad, so the record is the only trace of it.

### Programs of several operations

sqlib must calculate operation *N* against the state that operations 1 to *N−1*
left. When each operation is ground (a series of `INSERT DATA` and
`DELETE DATA`), this needs nothing special, because the composition is set
arithmetic. Otherwise sqlib simulates the program. It forks the store,
calculates each operation against the copy, and then runs the operation on the
copy before the next one.

sqlib runs each operation on the copy *as written*. The diff it just calculated
leaves out some effects, such as a counted graph operation, and only the
original text has them. This makes the simulation correct for each form.

A store must support forking. `DeltaStore.fork` is optional. A store without it
refuses such a program, and names the operation that needs it:

```ts
// In-process Oxigraph can fork, given a factory for empty stores.
oxigraphDeltaStore(store, { createStore: () => new oxigraph.Store() });
```

## Blank nodes

A blank node in a WHERE clause acts as a variable and causes no problem. A blank
node in a *template* is a new node for each solution, and this causes four
limits:

- **A patch can be applied once only.** It holds the nodes made in this run. A
  second application adds the same nodes again, and makes no new ones. The patch
  records `containsBnodes`.
- **A deletion with blank nodes cannot be applied as ground SPARQL text**,
  because `DELETE DATA` forbids blank nodes. Such a patch reports
  `applyMode: 'store'` and `revertible: false`. It must be applied through a
  store API.
- **Membership can be inexact.** A store that answers only SPARQL cannot say
  whether it holds a quad with a blank node, because no SPARQL text can name a
  blank node. sqlib keeps those candidates, because they were matched from the
  store a moment earlier, so the end state is correct. The patch reports
  `netEffectExact: false`. If the store has a `has` method (in-process Oxigraph
  does), the answer is exact.
- **Simulation refuses one case**: a program of several operations whose patch
  would have blank nodes. A fork gives the blank nodes new labels, so a deletion
  would name a node in the copy, and not in the store.

## What the package contains

The package has no Fastify, `fs` or network dependency. It is pure functions
over quad arrays and an abstract store. The server, the browser and a worker
therefore use the same code, and the place where patches are stored is a
separate decision.

The package does not manage transactions. Between the calculation and the
application of a patch, the store can change, unless the store prevents this.
In-process Oxigraph can prevent it with its own lock. An HTTP endpoint cannot,
so sqlib applies a patch to one with an optimistic check. It runs the
deletion-existence check again and compares it with the content hash of the
patch. A mismatch gives 409 with a new preview.

The test suite uses an oracle. It applies the update to store A, applies the
calculated patch to an identical store B, canonicalises both, and checks that
they are isomorphic. Each supported form goes through the oracle three times:
against a populated store with exact membership, through the SPARQL-only path
that an HTTP backend uses, and against an empty store. A harness test checks
that the oracle itself can fail.

```sh
pnpm --filter @sparql-query-lib/rdf-delta test
```

`packages/rdf-delta` is `private: true`, and is not published to npm. Packages
in the monorepo use it through the pnpm workspace.

## Where it appears in the product

### The output format of an update query

`text/rdf-patch` is the only output media type of an update query. A request for
it turns an execution into a calculation. In the web app, choose **RDF Patch** as
the output format of an update query, and Run shows a preview. Nothing is
executed and the store does not change. Applying the diff is a separate action.

You must ask for this format. An update with no `Accept` header runs. `/execute`
is what a scheduled job, an MCP tool or a query group calls, and each of these
expects an update to run.

```bash
# a saved update query, by its id
curl -sS -X POST "$SQLIB/execute" \
  -H 'Accept: text/rdf-patch' \
  -H 'Content-Type: application/json' \
  -d '{"targetId":"urn:sqlib:query:q1","backendId":"urn:sqlib:backend:b1"}'
```

A draft has no saved version to name, so it asks for the calculation directly.
The web app does this for an unsaved query:

```bash
curl -sS -X POST "$SQLIB/patches/preview" \
  -H 'Accept: text/rdf-patch' \
  -H 'Content-Type: application/json' \
  -d '{"updateString":"DELETE { … } INSERT { … } WHERE { … }","backendId":"urn:sqlib:backend:b1"}'
```

The calculation needs a registered backend to run against. Without one, the
request gets 400. The `/execute` response gives the patch id in
`X-Sqlib-Patch-Id`.

An update with a graph-management operation that was counted, and not listed,
gets 422. RDF Patch has rows for quads only, so such a document would show an
empty or partial change as if it were complete. The JSON view of the patch has
`graphOps`, so use it for such a preview.

### Stored patches

A patch is an entity, with an id of the form `urn:sqlib:patch:…`. It has no
versions, because a patch records one event. It records:

- the target backend and the graph scope,
- the canonical N-Quads of its additions and deletions,
- the net and raw counts, and any `graphOps`,
- where it came from, and its status,
- `applyMode`, `revertible` and `containsBnodes`,
- a content hash over the canonical sides.

Canonicalisation makes the hash stable, so sqlib can use it to find duplicates
and as an optimistic precondition when it applies a patch.

`GET /patches/:id` returns the entity as JSON by default, or the RDF Patch
document when the caller asks for `text/rdf-patch`. That route and the output of
an update query use the same serialiser, so a diff looks the same on both
routes.

The RDF Patch serialisation is the dialect that [RDF-Delta
uses](https://afs.github.io/rdf-delta/rdf-patch.html): `A` and `D` rows for
quads, and `H` headers with the id and the id of the previous patch. A consumer
that already reads this format needs no parser specific to sqlib.
