# `@sparql-query-lib/rdf-delta`

What a SPARQL update *would* do, without doing it.

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

## Why this works

SPARQL Update instantiates the DELETE and INSERT templates against the state of
the graph store *before* the operation. So `CONSTRUCT { D } WHERE { W }` and
`CONSTRUCT { I } WHERE { W }`, evaluated against the store as it stands, are not
an approximation of `DELETE { D } INSERT { I } WHERE { W }` — they are its
definition, minus the mutation. Two read-only queries yield the exact ground
delta.

What comes back is simultaneously a preview, an audit record, an undo (apply the
inverse) and a replication unit.

## What it is not

No Fastify, no `fs`, no network: pure functions over quad arrays and an abstract
store, so server-side, browser-side and worker-side derivation are the same
code, and where patches get *stored* stays a separate, later decision.

It is also not a transaction manager. The window between deriving a patch and
applying it is open unless the store closes it; in-process Oxigraph can do that
under its own lock, an HTTP endpoint cannot.

## What it covers today

| Form | Supported |
| --- | --- |
| `INSERT DATA`, `DELETE DATA` | ✅ |
| `DELETE WHERE` | ✅ |
| `INSERT … WHERE`, `DELETE … WHERE`, `DELETE … INSERT … WHERE` | ✅ |
| `WITH`, `USING`, `USING NAMED` | ✅ |
| `GRAPH <g>` and `GRAPH ?var` in templates | ✅ |
| Multi-operation programs, every operation ground | ✅ |
| Multi-operation programs where one reads what another wrote | ✅ on a store that can `fork` |
| `CLEAR`, `DROP`, `COPY`, `MOVE`, `ADD` | ✅ counted; exact with `enumerateGraphOps` |
| `CREATE` | ✅ (it moves no triples) |
| `LOAD` | ⚠️ recorded, never derived |

Unsupported forms throw `UnsupportedUpdateError` naming the operation. A preview
that is quietly wrong is worse than no preview.

## Graph-management operations

`CLEAR GRAPH <g>` names a graph, not triples, and what that graph holds is a
separate question with a separate cost. So by default it is **counted** — one
`SELECT (COUNT(*) …)` — and the patch says outright that its quads are not the
whole update:

```ts
const patch = await derivePatch('DROP GRAPH <http://ex/g>', store);
patch.graphOps;   // [{ form: 'drop', destination: {…}, affectedCount: 4200, enumerated: false }]
patch.applyMode;  // 'graph-ops' — a preview and an audit record, not a diff to apply
patch.revertible; // false
```

Pass `enumerateGraphOps` and the operation becomes ordinary quads, flowing
through the same net-effect arithmetic as everything else — so the patch is
applicable, revertible and hashable like any other. `enumerationCap` bounds it;
over the cap it throws `EnumerationCapExceededError` carrying what it would have
cost.

```ts
await derivePatch('DROP GRAPH <http://ex/g>', store, {
  enumerateGraphOps: true,
  enumerationCap: 10_000,
});
```

`LOAD` is the exception no option rescues: its document is outside the dataset,
so no query against the store can say what it holds.

The `graphOps` records are kept even when the operations *were* enumerated.
"These quads went because the graph was dropped" is a different fact from "these
quads were deleted" — and an empty graph created or removed leaves no quad at
all, so the record is the only place that survives.

## Multi-operation programs

Operation *N* has to be derived against the state operations 1…*N−1* left. When
every operation is ground (`INSERT DATA` / `DELETE DATA` sequences) that needs
nothing special — composition is set arithmetic. Otherwise the program is
**simulated**: the store is forked, each operation derived against the copy and
then replayed on it before the next.

Replaying the operation *as written*, rather than the diff just derived, is what
makes this faithful for every form — only the original text carries the effects
the diff deliberately leaves out, such as a counted graph operation.

Forking is a capability, not an assumption. `DeltaStore.fork` is optional, and a
store without it keeps the refusal, naming the offending operation:

```ts
// In-process Oxigraph can fork, given a factory for empty stores.
oxigraphDeltaStore(store, { createStore: () => new oxigraph.Store() });
```

Simulation refuses one case outright: a program whose patch would carry blank
nodes. A copy relabels them, so a deletion would name a node in the copy rather
than in the store.

## Net effect

The raw template instantiations overstate the change: deleting an absent triple
and inserting a present one are both no-ops, and a triple deleted and re-inserted
by the same operation never goes away. With `S` the store and `D*`/`I*` the
instantiated templates, the patch is

```
deletions = (S ∩ D*) \ I*
additions = I* \ S
```

The raw counts survive as `rawDeleteCount` / `rawInsertCount`, because "you asked
to delete 12, 9 existed" is the interesting half of a preview.

Set membership uses RDF term equality on parsed terms, never string equality on
rendered ones: `:rel` and `<http://…/rel>` are the same IRI, and a set keyed on
source text would see two (issue #165).

## Blank nodes

A template blank node is minted fresh per solution, so a patch captures the
concrete nodes from *our* instantiation and is apply-once. `DELETE DATA` forbids
blank nodes, so a patch whose deletions carry them reports
`applyMode: 'store'` and `revertible: false` — it has to go through a store API
rather than ground SPARQL text.

A store that can only be asked SPARQL cannot be asked whether it holds a quad
containing a blank node, since no SPARQL text can name one. Such candidates are
kept (they were matched out of the store a moment earlier, so the end state is
right) and the patch reports `netEffectExact: false`. Give the store a `has`
— in-process Oxigraph has one — and the answer is exact.

## Testing

The rewrite has an oracle, and the suite is built on it: apply the update to
store A, apply the derived patch to an identical store B, canonicalise both,
assert isomorphism. Every supported form runs through it three times — against a
populated store with exact membership, through the SPARQL-only path an HTTP
backend takes, and over an empty store — and `test/harness.test.ts` checks the
oracle itself can fail.

```
pnpm --filter @sparql-query-lib/rdf-delta test
```

## Design

`docs/explanation/rdf-patch.md` covers what a patch is, how one is derived,
which update forms are supported, and why this lives in a package of its own
rather than inside the API.
