# Proposal: the notebook becomes a document you author

Status: proposal. Supersedes the current auto-generated library notebook
(`packages/web/src/pages/library.vue`, `components/library-notebook/*`).

## 1. What is there today, and what is wrong with it

The library page is a *rendering* of a library: it loads the export bundle,
makes one cell per exportable query, and lays them out in bundle order behind a
contents rail with a filter and a tag bar. Each cell is a fixed apparatus —
description, signature, examples, an args builder, template/substituted toggle,
Run, result table, recorded results, "save as test".

Three consequences follow from "rendered, not authored":

- **It is exhaustive.** A library with forty queries is a forty-cell page. The
  filter bar exists to make that bearable, which is the tell: the page has no
  way to say *these five queries are the point, start here*. Everything is
  equally weighted because nothing chose the weighting.
- **It has no prose.** The only text is the library description and each query's
  own description. There is nowhere to write "first pull the candidate set, then
  reason over it, then check the residual" — the sentence that makes a sequence
  of queries legible as work rather than as a catalogue.
- **It has no sequence.** Cells are independent. Each one runs against the
  library's backend and throws its result on the floor. The one thing a notebook
  is *for* — cell 3 uses what cell 2 produced — is the one thing it cannot do,
  even though the engine underneath does exactly that for query groups.

The apparatus inside a cell is good and should survive. The page around it
should stop being generated.

## 2. The change

A notebook is an ordered list of cells that a person writes. A library may have
several. It starts empty.

Cell kinds:

| Kind | Holds | Runs |
| --- | --- | --- |
| **Markdown** | prose, headings, links | nothing |
| **Query** | a reference to a query (+ arguments) | `POST /execute` against a query version |
| **Group** | a reference to a query group (+ start-node inputs) | `POST /execute` against a group version |
| **Rule set** | a reference to a rule set (+ an input graph) | `POST /rule-sets/:id/execute` |
| **Data** *(later)* | a data graph / tuple set reference or inline RDF | nothing; it *is* a value |

Adding a cell is an import: a picker over the library's queries, groups and rule
sets, the same picker the rest of the app uses. A cell never holds a query's
text of its own — it points at a versioned entity, and editing is still a
backlink to the editor. That keeps the one property the current notebook has
that is worth keeping: **the notebook never mutates the library**, so it is safe
to hand to someone who cannot write to it.

### What we can import today, honestly

- **Queries** — yes, everywhere. Bundle-carried, runnable through `/execute`.
- **Query groups** — server-side yes (`/execute` takes a `QueryGroup` or
  `QueryGroupVersion` target, and `dataGraphs` to fill its start node).
  Bundle-carried too (`ExportBundle.groups`, `runtime/src/group.ts` chains them
  client-side) but **only SELECT→VALUES groups**: a group with an `RDF_GRAPH` or
  `BOOLEAN` edge, or a rule-set or ETL node, is refused at export. The library
  page ignores `bundle.groups` entirely today — cells for them are new UI over
  existing data.
- **Rule sets** — server-side yes, through their own route, which already takes
  `dataGraphVersionId` / `dataGraphId` / `dataGraphInline` as the base graph.
  **Not** in the export bundle at all. So a rule-set cell works in the app and
  is dead weight in a static export until the bundle grows a `ruleSets` member.

That asymmetry is worth stating in the UI rather than hiding: a notebook holding
rule-set cells exports to HTML with those cells rendered as documentation and
marked "runs on the server only".

## 3. Outputs: naming what a cell produced

Every run binds its result to a name in the notebook's scope. The name is
auto-assigned (`out1`, `out2`, …) and renameable inline; renaming rewrites the
references, as a spreadsheet does.

A value is one of three types, and the type is what decides where it can go next:

| Type | Produced by | Backed by | Stat chip |
| --- | --- | --- | --- |
| **Rows** | SELECT, a group ending in one | `TupleSetVersion` shape (`rowCount`, `byteSize`, `tupleColumns`) | `1,204 rows · 4 cols · 88 KB` |
| **Graph** | CONSTRUCT, DESCRIBE, a rule set | `DataGraphVersion` shape (`tripleCount`, `byteSize`) | `18,332 triples · 2.1 MB` |
| **Boolean** | ASK | — | `true` |

The stats are not new work: `DataGraphVersion` already computes `tripleCount`
and `byteSize` at write, `TupleSetVersion` already carries `rowCount` and
`byteSize`. A notebook value is the same shape held in session scratch, and
**Save** promotes it to a real versioned `DataGraph` / `TupleSet` in the library
— at which point it has an IRI, a version and provenance, and every other screen
can see it. That is the upgrade path from "I was poking at this" to "this is an
input other things use", and it needs no new storage concept.

Scoping rule: a name is defined by the cell that produced it and visible to
cells below it. Re-running a cell rebinds the name and marks every dependent
cell stale (a dot on the run button, not an auto-cascade — Jupyter's staleness
honesty, not a reactive rerun).

## 4. Piping, and how far it actually goes

The interesting question — can you go CONSTRUCT → CONSTRUCT → CONSTRUCT — has a
three-tier answer, and the tiers should be visible rather than papered over.

**Rows → a parameter slot.** Fully supported, both sides. This is what a group
edge does (`VARIABLE_BINDINGS` → a `VALUES` block), and `runtime/src/group.ts`
does it in the browser too. A downstream query cell offers, per slot, "fill from
`@out1`" with the same name-then-position column mapping groups use. Zero new
execution machinery.

**Graph → a rule set.** Supported. `POST /rule-sets/:id/execute` takes the base
graph three ways, and `dataGraphInput.ts` was built precisely so a construct
node's output could seed a downstream rule set. A rule-set cell takes `@out1` as
its base graph directly.

**Graph → a query.** *Not* supported as a direct wire, and this is the real
constraint: a query runs against a store, so RDF only reaches one if it is
materialized into a store that query also targets. `/execute` refuses
`dataGraphs` for a query target on purpose, and `GraphBuilder.validateGraph`
refuses the same edge on the canvas without an ephemeral `backendConfig`.

So a CONSTRUCT → CONSTRUCT chain needs an explicit **materialize** step, and the
notebook should make it a visible cell rather than hide it:

> `@out2` (18,332 triples) → **materialize into** `@store1` (ephemeral Oxigraph)

Downstream query cells then pick `@store1` as their backend instead of the
library default. Mechanically this is the ephemeral-backend path the group
engine already takes, plus `OxigraphDataGraphSource` hydration for a saved
graph. Making it a cell rather than an invisible coercion means the reader sees
where the data actually landed and what it cost — which is the same reason
sqlib refuses the edge on the canvas.

## 5. Is a notebook then a "dynamic query group"?

Nearly, and the difference is worth keeping.

A query group is a **DAG you wire**, saved, versioned, executed as one unit by
the server, re-runnable from an API call with no UI in the picture. A notebook
is a **sequence you walk**, with prose between the steps, partial runs, dead
ends left in, and a human deciding after each cell whether the next one is still
a good idea. Collapsing them would cost the group its one-shot executability and
cost the notebook its ability to hold a step that did not work out.

The right relationship is a one-way door: **Promote to query group.** A notebook
whose cells form a clean chain — every cell a query/group/ruleset, every input
either a literal argument or a reference to a cell above it, no orphans — offers
a button that writes a `QueryGroup` version with the corresponding nodes and
edges. Markdown cells become the group's description. A notebook that cannot be
promoted says which cell broke the shape.

That gives the exploratory path and the production path the obvious seam between
them, and means the notebook does not need to grow a scheduler, an API surface,
or a versioned execution semantics of its own.

## 6. Where the current page goes

Do not delete it — turn it into a starting point instead of the only point.

- The library screen keeps a **Contents** view: the current rendering, minus the
  per-cell run apparatus, as "everything this library holds". That is a real
  need (it is the catalogue) and it is honest about being generated.
- **New notebook** starts empty, with a "Start from the library" action that
  drops in one cell per query — i.e. today's page, as an *editable starting
  draft* someone then cuts down to the five that matter and writes prose around.
- `SaveAsTestDialog`, the args element, `CodePeek`, the result table and the
  term-display menus move into the query cell unchanged.

## 7. Export

A notebook is the natural unit for both existing exports, and both get better:

- **HTML** — the self-contained page becomes the notebook in reading order:
  prose, cells, and client-side chaining where the runtime can do it
  (SELECT→VALUES). Cells that need the server (rule sets, materialization) render
  as documented-but-not-runnable, stated on the cell.
- **ipynb** — `packages/api/src/lib/export/notebook.ts` stops synthesizing one
  markdown + one code cell per query and instead maps notebook cells 1:1:
  markdown cells pass through as markdown, run cells become code cells with the
  substituted text. The no-live-substitution-in-Python rule stands; a chained
  cell exports with its upstream call inlined above it.

## 8. What is missing, in dependency order

1. **Notebook entity + routes.** `Notebook` / `NotebookVersion` under a library,
   cells as an ordered list. Follows the existing pointer + immutable version
   pattern. (Alternative for phase 1: notebooks live in browser scratch only,
   which gets the UX in front of people without a schema commitment.)
2. **Named outputs and the stat chip.** Session-scoped values, Save promoting to
   `DataGraph` / `TupleSet` versions. No API change for the promote path —
   `POST /data-graphs/:id/versions` and the tuple-set equivalent already exist.
3. **Rows → slot wiring** in the query cell. Reuses the group mapping rules.
4. **Rule-set and group cells.** Existing routes; new UI.
5. **Materialize cell** → ephemeral backend, for graph → query.
6. **Bundle `ruleSets`** (and a decision on whether SRL evaluation can run in the
   browser at all) before rule-set cells mean anything in a static export.
7. **Promote to query group.**

Phases 1–3 are the ones that change the experience; the rest is reach.

## 9. Open questions

- Does a notebook belong to a library, or can it span libraries? (Cross-library
  chaining is legal at the engine level; access control is per library.)
- Is a raw-SPARQL cell allowed? It would need the `/sparql` right, which is
  exactly the right the current notebook is careful not to require. Suggestion:
  gate it behind the same right and default it off, so the notebook stays
  shareable with a read-only reader.
- Does a saved notebook pin query *versions* or float to current? Floating is
  what makes a notebook a living document; pinning is what makes a re-run
  reproducible. Probably: float by default, pin on promote-to-group.
