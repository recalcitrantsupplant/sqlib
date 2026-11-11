# `@sparql-query-lib/rdf-delta`

Calculates the effect of a SPARQL update, and does not apply it.

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

## How it works

SPARQL Update fills the DELETE and INSERT templates from the state of the graph
store *before* the operation. Two read-only queries against the current store
are therefore the definition of `DELETE { D } INSERT { I } WHERE { W }`, with no
write:

- `CONSTRUCT { D } WHERE { W }`;
- `CONSTRUCT { I } WHERE { W }`.

Together they give the exact ground delta.

You can use the result in four ways:

- as a preview;
- as an audit record;
- as an undo, when you apply the inverse;
- as a unit of replication.

## Scope

The package has no Fastify, no `fs` and no network. It has pure functions over
quad arrays and an abstract store. A server, a browser and a worker therefore
run the same code. Where to store patches is a separate decision.

The package does not manage transactions. A write can occur between the
derivation of a patch and its application, unless the store prevents it.
In-process Oxigraph can prevent it under its own lock. An HTTP endpoint cannot.

## Supported forms

| Form | Supported |
| --- | --- |
| `INSERT DATA`, `DELETE DATA` | ✅ |
| `DELETE WHERE` | ✅ |
| `INSERT … WHERE`, `DELETE … WHERE`, `DELETE … INSERT … WHERE` | ✅ |
| `WITH`, `USING`, `USING NAMED` | ✅ |
| `GRAPH <g>` and `GRAPH ?var` in templates | ✅ |
| Multi-operation programs, each operation ground | ✅ |
| Multi-operation programs where one operation reads what another wrote | ✅ on a store that can `fork` |
| `CLEAR`, `DROP`, `COPY`, `MOVE`, `ADD` | ✅ counted; exact with `enumerateGraphOps` |
| `CREATE` | ✅ (it moves no triples) |
| `LOAD` | ⚠️ recorded, never derived |

An unsupported form throws `UnsupportedUpdateError`, which names the operation.
A preview that is wrong with no error is worse than no preview.

## Graph-management operations

`CLEAR GRAPH <g>` names a graph. To know its triples needs a separate query,
with a separate cost. By default, the package therefore **counts** them with one
`SELECT (COUNT(*) …)`. The patch then says that its quads are not the whole
update:

```ts
const patch = await derivePatch('DROP GRAPH <http://ex/g>', store);
patch.graphOps;   // [{ form: 'drop', destination: {…}, affectedCount: 4200, enumerated: false }]
patch.applyMode;  // 'graph-ops': a preview and an audit record, not a diff to apply
patch.revertible; // false
```

With `enumerateGraphOps`, the operation becomes ordinary quads. These go through
the same net-effect calculation as all other quads. The patch can then be
applied, reverted and hashed. `enumerationCap` sets a limit. Above the limit,
`derivePatch` throws `EnumerationCapExceededError`, with the cost that it found.

```ts
await derivePatch('DROP GRAPH <http://ex/g>', store, {
  enumerateGraphOps: true,
  enumerationCap: 10_000,
});
```

No option makes `LOAD` exact. Its document is outside the dataset, so no query
against the store can read it.

The patch keeps the `graphOps` records after an enumeration also. A quad removed
by a dropped graph and a deleted quad are different facts. Also, the creation
or removal of an empty graph changes no quad, so the record is the only trace.

## Multi-operation programs

Operation *N* must be derived against the state that operations 1 to *N−1*
left. When each operation is ground (a sequence of `INSERT DATA` and
`DELETE DATA`), this is set arithmetic.

For other programs, the package **simulates** the program:

1. It forks the store.
2. It derives each operation against the copy.
3. It runs the operation on the copy before the next one.

Step 3 runs the operation text, and not the derived diff. The diff omits some
effects on purpose, for example a counted graph operation. Only the text has
all of them, so the simulation is correct for each form.

A store can fork only if it says so. `DeltaStore.fork` is optional. For a store
without it, the package refuses the program, and names the operation:

```ts
// In-process Oxigraph can fork, given a factory for empty stores.
oxigraphDeltaStore(store, { createStore: () => new oxigraph.Store() });
```

Simulation refuses one case: a program whose patch has blank nodes. A copy
gives blank nodes new labels, so a deletion would name a node in the copy, and
not in the store.

## Net effect

The raw template results overstate the change. A deletion of an absent triple
does nothing, and so does an insertion of a present one. A triple that one
operation deletes and inserts again stays. With `S` the store, and `D*` and
`I*` the filled templates, the patch is:

```
deletions = (S ∩ D*) \ I*
additions = I* \ S
```

The patch keeps the raw counts as `rawDeleteCount` and `rawInsertCount`. A
preview that says "you asked to delete 12, and 9 existed" is useful.

Set membership uses RDF term equality on parsed terms. It does not compare
serialised strings. `:rel` and `<http://…/rel>` are the same IRI, and a set
keyed on source text sees two (issue #165).

## Blank nodes

An update makes a new blank node in a template for each solution. A patch
records the nodes of one instantiation, so you can apply it once only.
`DELETE DATA` does not allow blank nodes. A patch with blank nodes in its
deletions therefore has `applyMode: 'store'` and `revertible: false`. It must
go through a store API. Ground SPARQL text cannot apply it.

No SPARQL text can name a blank node. A store that only answers SPARQL cannot
say if it holds a quad with a blank node. The package keeps such candidates,
because they came from the store a moment before, so the end state is correct.
The patch then has `netEffectExact: false`. Give the store a `has` method to
make the result exact. In-process Oxigraph has one.

## Testing

The suite uses an oracle:

1. Apply the update to store A.
2. Apply the derived patch to an identical store B.
3. Canonicalise both stores, and check that they are isomorphic.

Each supported form goes through the oracle three times:

- against a populated store with exact membership;
- through the SPARQL-only path that an HTTP backend uses;
- against an empty store.

`test/harness.test.ts` checks that the oracle can fail.

```
pnpm --filter @sparql-query-lib/rdf-delta test
```

## Design

`docs/explanation/rdf-patch.md` explains what a patch is, how the package
derives one, which update forms it supports, and why it is a separate package
from the API.
