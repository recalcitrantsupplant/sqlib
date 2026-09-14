# RDF Patch: what an update would do

`@sparql-query-lib/rdf-delta` derives what a SPARQL update would add and remove,
without running it.

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

What comes back is simultaneously a preview, an audit record, an undo (apply the
inverse) and a replication unit.

## Why two CONSTRUCTs are the definition, not an approximation

SPARQL Update instantiates the DELETE and INSERT templates against the state of
the graph store *before* the operation. So `CONSTRUCT { D } WHERE { W }` and
`CONSTRUCT { I } WHERE { W }`, evaluated against the store as it stands, are the
definition of `DELETE { D } INSERT { I } WHERE { W }` minus the mutation. Two
read-only queries yield the exact ground delta.

That is why the derivation is not a heuristic that happens to be usually right.
The only ways it can diverge are named and bounded: a graph-management operation
whose contents were counted rather than enumerated, a `LOAD` whose document lies
outside the dataset, and a store that cannot be asked about a quad containing a
blank node. Each is reported on the patch rather than folded silently into the
counts.

Per form, the rewrite is:

| Update form | Deletions come from | Additions come from |
| --- | --- | --- |
| `INSERT DATA { G }` | none | `G`, already ground; no query needed |
| `DELETE DATA { G }` | `G`, filtered to the triples actually present | none |
| `DELETE { D } WHERE { W }`, `DELETE WHERE { P }` | `CONSTRUCT { D } WHERE { W }` (for the shorthand, `D = W = P`) | none |
| `INSERT { I } WHERE { W }` | none | `CONSTRUCT { I } WHERE { W }` |
| `DELETE { D } INSERT { I } WHERE { W }` | `CONSTRUCT { D } WHERE { W }` | `CONSTRUCT { I } WHERE { W }` |

`USING` and `USING NAMED` map onto the CONSTRUCT's `FROM` / `FROM NAMED` dataset
clause, and `WITH` onto `GRAPH` wrapping.

CONSTRUCT produces triples rather than quads, so a template containing `GRAPH`
blocks is decomposed by graph context: the default-graph portion and each
`GRAPH g { … }` block become separate CONSTRUCTs sharing the same WHERE, and the
assembler stamps each result set with its graph before merging. Against an
in-process Oxigraph store the derivation skips SPARQL text entirely, evaluating
the WHERE clause once and instantiating the templates over the solution sequence
in JavaScript. That path is both exact and cheap, and it is the one the test suite
treats as the reference implementation.

## Net effect

The raw template instantiations overstate the change. Deleting an absent triple
and inserting a present one are both no-ops, and a triple deleted and re-inserted
by the same operation never goes away. With `S` the store and `D*` / `I*` the
instantiated templates, the post-state is `S' = (S \ D*) ∪ I*`, so the net patch
is

```
deletions = (S ∩ D*) \ I*
additions = I* \ S
```

The raw counts survive as `rawDeleteCount` and `rawInsertCount`, because "you
asked to delete 12, 9 existed" is the interesting half of a preview.

These set operations run in the deriving process rather than in SPARQL: both
CONSTRUCT results are materialised as quad arrays, and membership tests against
the store are batched into chunked existence queries. Set membership uses RDF term
equality on parsed terms, never string equality on rendered ones — `:rel` and
`<http://…/rel>` are the same IRI, and a set keyed on source text would see two.

## What it covers

| Form | Supported |
| --- | --- |
| `INSERT DATA`, `DELETE DATA` | yes |
| `DELETE WHERE` | yes |
| `INSERT … WHERE`, `DELETE … WHERE`, `DELETE … INSERT … WHERE` | yes |
| `WITH`, `USING`, `USING NAMED` | yes |
| `GRAPH <g>` and `GRAPH ?var` in templates | yes |
| Multi-operation programs, every operation ground | yes |
| Multi-operation programs where one reads what another wrote | yes, on a store that can `fork` |
| `CLEAR`, `DROP`, `COPY`, `MOVE`, `ADD` | counted; exact with `enumerateGraphOps` |
| `CREATE` | yes — it moves no triples |
| `LOAD` | recorded, never derived |

An unsupported form throws `UnsupportedUpdateError` naming the operation. A
preview that is quietly wrong is worse than no preview.

### Graph-management operations

`CLEAR GRAPH <g>` names a graph, not triples, and what that graph holds is a
separate question with a separate cost. So by default it is counted — one
`SELECT (COUNT(*) …)` — and the patch says outright that its quads are not the
whole update:

```ts
const patch = await derivePatch('DROP GRAPH <http://ex/g>', store);
patch.graphOps;   // [{ form: 'drop', destination: {…}, affectedCount: 4200, enumerated: false }]
patch.applyMode;  // 'graph-ops' — a preview and an audit record, not a diff to apply
patch.revertible; // false
```

Pass `enumerateGraphOps` and the operation becomes ordinary quads, flowing through
the same net-effect arithmetic as everything else, so the patch is applicable,
revertible and hashable like any other. `enumerationCap` bounds it; over the cap it
throws `EnumerationCapExceededError` carrying what it would have cost.

```ts
await derivePatch('DROP GRAPH <http://ex/g>', store, {
  enumerateGraphOps: true,
  enumerationCap: 10_000,
});
```

`LOAD` is the exception no option rescues: its document is outside the dataset, so
no query against the store can say what it holds.

The `graphOps` records are kept even when the operations were enumerated. "These
quads went because the graph was dropped" is a different fact from "these quads
were deleted", and an empty graph created or removed leaves no quad at all, so the
record is the only place that survives.

### Multi-operation programs

Operation *N* has to be derived against the state operations 1…*N−1* left. When
every operation is ground — a sequence of `INSERT DATA` and `DELETE DATA` — that
needs nothing special, because composition is set arithmetic. Otherwise the program
is simulated: the store is forked, each operation derived against the copy and then
replayed on it before the next.

Replaying the operation *as written*, rather than the diff just derived, is what
makes this faithful for every form. Only the original text carries the effects the
diff deliberately leaves out, such as a counted graph operation.

Forking is a capability, not an assumption. `DeltaStore.fork` is optional, and a
store without it keeps the refusal, naming the offending operation:

```ts
// In-process Oxigraph can fork, given a factory for empty stores.
oxigraphDeltaStore(store, { createStore: () => new oxigraph.Store() });
```

## Blank nodes

A blank node in a WHERE clause behaves as a variable and raises no difficulty. A
blank node in a *template* is minted fresh per solution, and that is where the
caveats come from.

- **A patch is apply-once.** It captures the concrete nodes from this
  instantiation, so re-applying it re-adds the same nodes rather than minting fresh
  ones. The patch records `containsBnodes`.
- **A deletion carrying blank nodes cannot be applied as ground SPARQL text**,
  because `DELETE DATA` forbids them. Such a patch reports `applyMode: 'store'` and
  `revertible: false`: it has to go through a store API rather than through SPARQL
  text.
- **Membership can be inexact.** A store that can only be asked SPARQL cannot be
  asked whether it holds a quad containing a blank node, since no SPARQL text can
  name one. Those candidates are kept — they were matched out of the store a moment
  earlier, so the end state is right — and the patch reports
  `netEffectExact: false`. Give the store a `has` method, which in-process Oxigraph
  has, and the answer is exact.
- **Simulation refuses one case outright**: a multi-operation program whose patch
  would carry blank nodes. A fork relabels them, so a deletion would name a node in
  the copy rather than in the store.

## What the package is, and is not

No Fastify, no `fs`, no network: pure functions over quad arrays and an abstract
store, so server-side, browser-side and worker-side derivation are the same code,
and where patches get stored stays a separate decision.

It is also not a transaction manager. The window between deriving a patch and
applying it is open unless the store closes it. In-process Oxigraph can close it
under its own lock; an HTTP endpoint cannot, so applying against one carries an
optimistic guard — the deletion-existence check is re-run and compared against the
patch's content hash, and a mismatch is a 409 with a fresh preview.

The derivation has an oracle, and the test suite is built on it: apply the update
to store A, apply the derived patch to an identical store B, canonicalise both,
assert isomorphism. Every supported form runs through it three times — against a
populated store with exact membership, through the SPARQL-only path an HTTP backend
takes, and over an empty store — and a harness test checks that the oracle itself
can fail.

```sh
pnpm --filter @sparql-query-lib/rdf-delta test
```

`packages/rdf-delta` is `private: true` and is not published to npm. It is consumed
inside the monorepo through the pnpm workspace.

## Where it surfaces in the product

### An update query's output format

`text/rdf-patch` is the one output media type an update query has, and asking for
it is what turns an execution into a derivation. In the web app, picking **RDF
Patch** as the output format for an update query is the one thing that turns Run
into a preview instead of a write: nothing is executed, the store is left as it
was, and applying the diff is a separate, deliberate act.

It has to be asked for explicitly. An update with no `Accept` header still runs,
because `/execute` is what a scheduled job, an MCP tool or a query group calls, and
silently turning every one of those into a dry run would be a worse surprise than
having to name the format you want.

```bash
# a saved update query, by its id
curl -sS -X POST "$SQLIB/execute" \
  -H 'Accept: text/rdf-patch' \
  -H 'Content-Type: application/json' \
  -d '{"targetId":"urn:sqlib:query:q1","backendId":"urn:sqlib:backend:b1"}'
```

A draft that has no saved version to name asks for the derivation directly, which
is what the web app does for an unsaved query:

```bash
curl -sS -X POST "$SQLIB/patches/preview" \
  -H 'Accept: text/rdf-patch' \
  -H 'Content-Type: application/json' \
  -d '{"updateString":"DELETE { … } INSERT { … } WHERE { … }","backendId":"urn:sqlib:backend:b1"}'
```

Deriving a patch needs a registered backend to derive it against; without one the
request is a 400. The `/execute` response carries the patch id in
`X-Sqlib-Patch-Id`. An
update performing a graph-management operation that was counted rather than
enumerated is a 422, because RDF Patch has rows for quads and nothing else — such a
document would show an empty or partial change and read as the whole truth. The
JSON view of the patch carries `graphOps`, so that is where such a preview is
answered.

### Stored patches

A patch is an entity in its own right, minted as `urn:sqlib:patch:…` and
deliberately not versioned: a patch is an event, and a stable/version split would be
noise. It records the target backend, the graph scope, the canonical N-Quads of its
additions and deletions, the net and raw counts, any `graphOps`, where it came from,
its status, `applyMode`, `revertible`, `containsBnodes` and a content hash over the
canonical sides. Canonicalisation is what makes the hash stable enough to use for
deduplication and for an optimistic precondition on apply.

`GET /patches/:id` returns the entity as JSON by default, or the RDF Patch document
when the caller asks for `text/rdf-patch`. Both that route and an update query's
output serialise through the same function, so a diff does not render differently
depending on which door it came through.

The RDF Patch serialisation is the dialect [RDF-Delta
uses](https://afs.github.io/rdf-delta/rdf-patch.html) — `A` and `D` rows for quads,
`H` headers carrying the id and the prior patch id — so a consumer that already
speaks it needs no sqlib-specific parser.
