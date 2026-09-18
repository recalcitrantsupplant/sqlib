# Proposal: the notebook becomes a portable, server-backed story

Status: proposal. Supersedes the current auto-generated library notebook
(`packages/web/src/pages/library.vue`, `components/library-notebook/*`).

## 1. Two artefacts, two jobs

sqlib has one export today and it is quietly being asked to do two jobs. It
should keep doing one.

**The export bundle** (`ExportBundle`, `@sparql-query-lib/runtime`,
`docs/guides/static-export.md`) exists so a front-end can call a triplestore
*directly*, with no sqlib in the request path. That constrains it, correctly, to
what a parser-free runtime can do in a browser: compiled query templates with
slot spans, and the SELECT→VALUES subset of query groups. Rule sets are not in
it; groups with `RDF_GRAPH` or `BOOLEAN` edges are refused at export. Those are
not gaps to close — they are the shape of a deployment artefact whose whole
value is that it has no server.

**A notebook** is a different thing: a portable *story* — prose interleaved with
runs — that by default calls the sqlib REST API. Because it calls the API, it
gets the whole product: rule sets, groups with any edge type, argument sets,
data graphs, tests, backends, access control. Because it is a small declarative
document rather than a compiled artefact, it is diffable, reviewable, and can be
handed to someone as a file or a link.

The static bundle is what you deploy. The notebook is what you send someone so
they understand what the library is for. Keeping them separate means neither has
to be compromised for the other, and it removes the awkwardness in the previous
draft of this proposal, where a rule-set cell was "dead weight until the bundle
grows a `ruleSets` member". It never needs to: a notebook is not a bundle.

## 2. What is there today, and what is wrong with it

The library page is a *rendering* of a library: it loads the export bundle,
makes one cell per exportable query, and lays them out in bundle order behind a
contents rail with a filter and a tag bar. Each cell is a fixed apparatus —
description, signature, examples, an args builder, template/substituted toggle,
Run, result table, recorded results, "save as test".

Three consequences follow from "rendered, not authored":

- **It is exhaustive.** A library with forty queries is a forty-cell page. The
  filter bar exists to make that bearable, which is the tell: the page has no
  way to say *these five queries are the point, start here*.
- **It has no prose.** The only text is the library description and each query's
  own description. There is nowhere to write "first pull the candidate set, then
  reason over it, then check the residual" — the sentence that makes a sequence
  of queries legible as work rather than as a catalogue.
- **It has no sequence.** Cells are independent and each throws its result on
  the floor. The one thing a notebook is *for* — cell 3 uses what cell 2
  produced — is the one thing it cannot do, even though the engine underneath
  does exactly that for query groups.

It is also built on the bundle, which is why it inherits the bundle's limits
(queries only) for no reason: it runs against a live server, through
`POST /execute`. The apparatus inside a cell is good and should survive. The
page around it should stop being generated, and the data behind it should come
from the API rather than from a deployment artefact.

## 3. The format

A notebook is a small JSON document: metadata, a server binding, an ordered list
of cells. It is the thing that travels.

```jsonc
{
  "format": "sqlib-notebook/1",
  "title": "Finding unlinked assets",
  "library": "urn:sqlib:library:estates",     // the library its cells name
  "cells": [
    { "kind": "markdown", "source": "## 1. Candidates\n\nStart with the ..." },

    { "kind": "query",
      "query": "urn:sqlib:query:unlinked-assets",   // floats to current version
      "arguments": { /* the same CallPayload /execute takes */ },
      "out": "candidates" },

    { "kind": "markdown", "source": "Those 1,204 rows are the input to ..." },

    { "kind": "ruleset",
      "ruleSet": "urn:sqlib:ruleset:asset-closure",
      "inputGraph": { "$ref": "shapes" },
      "out": "closure" }
  ]
}
```

Three properties matter and all three come from it being declarative:

- **Small.** A cell is a reference plus arguments, not a compiled query. A
  twelve-cell notebook is a few kilobytes.
- **Diffable.** It lives next to the library in git if you want it to, and a
  changed argument is a one-line diff.
- **Honest about versions.** A cell names a query (floating to its current
  version) or a query *version* (pinned). Float by default — a notebook is a
  living document and should track the library it documents. Offer "pin
  everything" as an explicit act, for a notebook attached to a release.

**Outputs are not stored in the format.** A notebook is the story, not the run.
Results are held per session, and a cell that has not been run says so, exactly
as an `ipynb` with cleared outputs does. (An optional `outputs` sidecar for
"here is what I saw when I ran it" is a later question, and the same question
`--expected` already answers for the bundle.)

### Portability, precisely

A notebook travels; the entities it names do not. Sending someone a notebook
works when they have the library — the same server, a replica, a colleague's
instance with the same library imported. That is the honest boundary, and the
UI should state it rather than imply a notebook is self-contained.

There is no library import/export today (`GET /libraries/:id/export-bundle` is
the runtime artefact, not a round-trippable dump), so "here is my notebook" to
someone outside the deployment is currently "here is my notebook, and you will
need access to my server". Options, in increasing order of work:

1. **Link, not file** — the common case. A notebook is a URL on the server that
   already holds the library, shared with a reader who has read access. This is
   what most sharing actually is, and it works with nothing new.
2. **File plus a named server** — the notebook carries a `server` hint; opening
   it anywhere prompts for the sqlib base URL. Works today across replicas.
3. **Library round-trip** — a real import/export for library entities, which
   would make a notebook plus a library dump a genuinely portable pair. Worth
   wanting for its own reasons; out of scope here.

## 4. Cells

| Kind | Holds | Runs via |
| --- | --- | --- |
| **Markdown** | prose, headings, links | nothing |
| **Query** | a query (or version) reference + arguments | `POST /execute` |
| **Group** | a query group reference + start-node inputs | `POST /execute` (incl. `dataGraphs`) |
| **Rule set** | a rule set reference + a base graph | `POST /rule-sets/:id/execute` |
| **Data** | a data graph / tuple set reference, or inline RDF | nothing; it *is* a value |

All four run against the API, so all four are available now — no bundle
extension, no client-side SRL evaluator, no reimplementation of anything. Adding
a cell is an import: the same entity picker the rest of the app uses.

A cell never holds a query's text of its own; it points at a versioned entity,
and editing is a backlink to the editor. That keeps the property the current
notebook has that is worth keeping: **the notebook never mutates the library**,
so it is safe to hand to a reader who cannot write to it.

A **raw SPARQL cell** is deliberately not in the table. It would require the
`/sparql` right, which is exactly the right the current notebook is careful not
to need, and it would break the "everything here is a library entity" property
that makes promote-to-group (§7) possible. If it lands, gate it behind that
right and default it off.

## 5. Outputs: naming what a cell produced

Every run binds its result to a name in the notebook's scope: auto-assigned
(`out1`, `out2`, …), renameable inline, and renaming rewrites references.

A value is one of three types, and the type decides where it can go next:

| Type | Produced by | Shape | Stat chip |
| --- | --- | --- | --- |
| **Rows** | SELECT, a group ending in one | `rowCount`, `tupleColumns`, `byteSize` | `1,204 rows · 4 cols · 88 KB` |
| **Graph** | CONSTRUCT, DESCRIBE, a rule set | `tripleCount`, `byteSize` | `18,332 triples · 2.1 MB` |
| **Boolean** | ASK | — | `true` |

The stats are not new work: `DataGraphVersion` already computes `tripleCount`
and `byteSize` at write, `TupleSetVersion` already carries `rowCount` and
`byteSize`. A notebook value is the same shape in session scratch, and **Save**
promotes it to a real versioned `DataGraph` / `TupleSet` in the library — at
which point it has an IRI, provenance, and every other screen can see it. That
is the upgrade path from "I was poking at this" to "this is an input other
things use", over storage that already exists.

Re-running a cell rebinds its name and marks dependent cells **stale** — a dot
on the run button, not a cascade. Jupyter's honesty about staleness is the right
model: the notebook says the downstream result is from an older upstream and
lets the reader decide.

## 6. Piping between cells

Because cells run through the API, the notebook client (browser) holds each
result and passes it into the next call. Two ways to pass it, and the notebook
should use the first by default and offer the second when size says so:

**By value.** The result travels back into the next request — rows as the
`arguments` payload of a slot, RDF as `dataGraphInline`. Simple, no storage, and
the whole chain is visible in the request. Fine for a demonstration, which is
what a notebook is for.

**By reference.** The result is captured server-side into a scratch `DataGraph`
or `TupleSet` version, and downstream cells pass `dataGraphId` /
`argumentSetId`. Nothing crosses the wire twice. This is the same **Save** from
§5, so "this got too big to pass around" and "this is worth keeping" are one
mechanism. Suggest it past a byte threshold rather than switching silently.

What each wire can do today:

- **Rows → a parameter slot.** Fully supported. This is a group's
  `VARIABLE_BINDINGS` edge, and the same name-then-position column mapping
  applies. Nothing new server-side.
- **Graph → a rule set.** Fully supported. `POST /rule-sets/:id/execute` takes
  `dataGraphVersionId` / `dataGraphId` / `dataGraphInline`; `dataGraphInput.ts`
  was built for exactly this seam.
- **Graph → a query group.** Supported — `/execute` takes `dataGraphs` for a
  group's start-node inputs.
- **Graph → a query.** **The one gap.** `/execute` refuses `dataGraphs` on a
  query target, because a query runs against a store and RDF only reaches one if
  it is materialized into a store that query also targets. The canvas refuses
  the same edge without an ephemeral `backendConfig`.

So CONSTRUCT → CONSTRUCT → CONSTRUCT is the case that needs something. Two ways:

1. **A materialize cell** (no server change): `@out2` → `@store1`, an ephemeral
   Oxigraph store, which downstream query cells select as their backend instead
   of the library default. Visible, and the reader sees where the data landed.
2. **Let `/execute` take `dataGraphs` for a query target** (small server
   change): materialize into an ephemeral store and run the query against it —
   precisely what the group engine already does for a node with an ephemeral
   `backendConfig`. This is the elegant fix; it removes the notebook's only real
   bottleneck, and it removes it for the REST API generally, not just for
   notebooks.

Recommend (2), with (1) as the explicit form when someone wants the store to
persist across several cells. Either way the notebook's answer to "why is this
step here?" is a visible cell rather than a hidden coercion.

**This is not a production pipeline, and should not pretend to be.** A chain
that matters belongs in a query group: one versioned entity, executed server-
side in one call, no browser in the path. The notebook's chaining exists for
demonstration, exploration and teaching — where a human is reading between the
steps. The cost (results round-tripping through the client) is acceptable
precisely because that is the setting. The UI should say so where it matters:
past a threshold, or on a notebook that has been re-run many times, point at
promote-to-group.

## 7. Notebook and query group

A query group is a **DAG you wire**: saved, versioned, executed as one unit by
the server, re-runnable from an API call with no UI. A notebook is a **sequence
you walk**: prose between the steps, partial runs, dead ends left in, a human
deciding after each cell whether the next one is still a good idea. Collapsing
them costs the group its one-shot executability and costs the notebook its
ability to hold a step that did not work out.

The relationship is a one-way door: **Promote to query group.** A notebook whose
run cells form a clean chain — every input either a literal argument or a
reference to a cell above it, no orphans — writes a `QueryGroup` version with the
corresponding nodes and edges; markdown cells become its description. A notebook
that cannot be promoted names the cell that broke the shape. This is also why
raw SPARQL cells are a problem: they have nothing to promote *to*.

## 8. Where the current page goes

Do not delete it — demote it.

- The library screen keeps a **Contents** view: the current rendering, minus the
  per-cell run apparatus, as "everything this library holds". That is a real
  need — it is the catalogue — and it is honest about being generated. It can
  read the API rather than the export bundle.
- **New notebook** starts empty, with a "Start from the library" action that
  drops in one cell per query: today's page as an *editable draft*, which
  someone then cuts down to the five that matter and writes prose around.
- `SaveAsTestDialog`, the args element, `CodePeek`, the result table and the
  term-display menus move into the query cell unchanged.

## 9. Export, and the bundle's own future

- **`.sqlibnb` (the format above)** is the primary export: the story, portable,
  server-backed.
- **ipynb** — `packages/api/src/lib/export/notebook.ts` stops synthesizing one
  markdown + one code cell per query and instead maps notebook cells 1:1:
  markdown passes through, run cells become code cells that POST to the sqlib
  API. This is *better* than what it does today: calling `/execute` with a
  payload is a smaller, more honest code cell than a pre-substituted query
  string, it needs no re-implementation of term escaping in Python (the reason
  that file refuses live substitution), and the notebook stays parameterisable
  in Python because the server does the substituting.
- **HTML** — a self-contained page remains available for a notebook whose cells
  are all queries and SELECT-chaining groups, i.e. what the runtime can do
  without a server. It is a *narrowing*, clearly labelled, not the default. A
  notebook with rule-set cells is not exportable this way and should say so
  rather than silently drop them.
- **The export bundle is unchanged.** No `ruleSets` member, no RDF-edge groups.
  It keeps doing its one job.

## 10. What is missing, in dependency order

1. **The notebook format and storage.** Phase 1 can be browser scratch plus
   import/export of the JSON — that gets the experience in front of people with
   no schema commitment. Phase 2 makes it a first-class entity (`Notebook` /
   `NotebookVersion` under a library, the existing pointer + immutable version
   pattern), which is what gives it a URL to share.
2. **Cells over the API.** Query, group and rule-set cells against `/execute`
   and `/rule-sets/:id/execute`. All routes exist.
3. **Named outputs and the stat chip**, with **Save** promoting to
   `DataGraph` / `TupleSet` versions. No new routes.
4. **Rows → slot wiring** in the query cell (by value).
5. **`dataGraphs` on a query target** in `/execute`, closing the graph → query
   gap. Small, and useful beyond notebooks.
6. **Pass-by-reference** for large values, over the same Save path.
7. **ipynb export** rewritten against the format; **HTML** narrowed and labelled.
8. **Promote to query group.**

Steps 1–4 are what change the experience. 5 is the one server change worth
making early.

## 11. Open questions

- **Does a notebook belong to one library?** Cross-library chaining is legal at
  the engine level; access control is per library. A single `library` binding is
  simpler and covers the storytelling case — but "compare these two backends"
  wants two. Suggestion: one binding, per-cell override.
- **Pinned or floating?** Float by default (a notebook tracks the library it
  documents); "pin everything" as an explicit act, and implicitly on promote.
- **Does a shared notebook carry recorded outputs?** Cleared by default, as an
  `ipynb` is. An `--expected`-style sidecar is the same question the bundle has
  already answered once.
- **What does a notebook do when a query it names has been deleted?** The
  bundle's answer is "the export says what it skipped and why". A notebook can
  do better because it is live: the cell renders as a broken reference with the
  name it used to have, rather than vanishing.
