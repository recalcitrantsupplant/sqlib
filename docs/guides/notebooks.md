# Notebooks: prose, cells and named results

A **notebook** is a document you write about a library: prose interleaved with
runs, in the order that makes sense, with each run's result bound to a name the
cells below can use. It is the library's front page — the first entry on the
rail, at `/notebook` — and it replaced a screen that rendered every query in the
library as a cell whether or not anyone had asked for it. The contents of the
library are what you import here; what you write around them is the point.

Notebooks are listed in the sidebar like every other asset the rail holds. They
are kept in this browser (there is no server entity yet), autosave as you type,
and travel as a file — see §4.

## 1. What a cell is

A notebook starts empty. **Add** offers four kinds:

| Kind | Holds | Runs through |
| --- | --- | --- |
| Markdown | prose, headings, links, lists | nothing |
| Query | a query reference, plus its arguments | `POST /execute` |
| Query group | a group reference | `POST /execute` |
| Rule set | a rule set reference, plus a base graph | `POST /rule-sets/:id/execute` |

Everything runs through the REST API, which is why a rule-set cell works here
and cannot exist in an [export bundle](static-export.md): the bundle is for
calling a triplestore with no sqlib in the request path, so it carries compiled
queries and SELECT-chaining groups and nothing else. The two are different
artefacts with different jobs.

A cell **references** an entity — it never holds a copy of a query's text — and
tracks that entity's current version. Editing is a link back to the editor, so a
notebook is safe to hand to someone who cannot write to the library.

## 2. Values

Every run binds its result to a name: `out1`, `out2`, … , renameable in the cell
(renaming rewrites the references). A value is one of three types, and the type
decides where it can go next:

| Type | From | Stat chip |
| --- | --- | --- |
| Rows | SELECT, a group ending in one | `1,204 rows · 4 cols · 88 KB` |
| Graph | CONSTRUCT, DESCRIBE, a rule set | `18,332 triples · 2.1 MB` |
| Boolean | ASK | `true` |

Values live in the browser session. The document is the story, not the run, so a
notebook you re-open shows cells that have not run — the same contract a Jupyter
notebook with cleared outputs offers.

**Save** promotes a value to a real library entity: a graph becomes a
[data graph](../concepts.md) version, rows become a tuple set version (source
format `query-results`). That is the upgrade path from "I was poking at this" to
"this is an input other things use".

## 3. Chaining

A cell's parameter slot can be filled from a value bound **above** it. Pick the
value in the slot's source control; the columns are paired with the slot's
variables by name where the names match and by position otherwise — the same
rule a [query group](query-groups.md) edge uses, so a chain means the same thing
in both places.

Set what happens when the upstream is empty: skip this cell (the default), run
with no rows, or stop.

What each wire can carry:

- **Rows → a parameter slot** — supported.
- **Graph → a rule set's base graph** — supported; the triples are sent as
  `dataGraphInline`.
- **Graph → a query** — *not* supported. A query runs against a store, so RDF
  only reaches one if it is materialized into a store that query also targets.
  Save the graph and point a backend at it, or build a query group.

Chaining is **by value**: a result comes back to the browser and goes out again
in the next request. That is fine for the demonstrations a notebook is for, and
it is the wrong shape for production — a pipeline that matters belongs in a
query group, which the server runs in one call with no browser in the path.

Re-running a cell marks the cells below it **stale** rather than re-running
them. The notebook says the result below came from an older input and leaves the
decision to you.

## 4. Sharing a notebook

**Export** writes a `.sqlibnb` file: a small JSON document of the title, the
library it names, and the cells. No results — it is the story, not the run. It
is small enough to keep in git beside the library, and a changed argument is a
one-line diff.

```jsonc
{
  "format": "sqlib-notebook/1",
  "title": "Finding unlinked assets",
  "library": "urn:sqlib:library:estates",
  "cells": [
    { "kind": "markdown", "id": "md1", "source": "## 1. Candidates\n\n…" },
    { "kind": "query", "id": "c1", "query": "urn:sqlib:query:unlinked-assets", "out": "candidates" },
    { "kind": "ruleset", "id": "c2", "ruleSet": "urn:sqlib:rule-set:closure",
      "out": "closure", "inputGraph": { "from": "value", "ref": "candidates" } }
  ]
}
```

**Import** reads one back and switches to the library it names.

The boundary is worth stating plainly: **the notebook travels, the entities it
names do not**. Sending someone a file works when they have the library — the
same server, a replica, or an instance holding the same library. A cell whose
entity is missing renders as a broken reference rather than vanishing.

## 5. Versions

A cell floats to its entity's current version by default, so a notebook tracks
the library it documents. A document may pin a version instead (`"version": 3`
on the cell), which is what you want for a notebook attached to a release.

## 6. The library's own exports

Two actions under **Export** are about the library rather than about the
notebook, and live here because this screen is the library's front page:

- **The library, as a runnable page** — the self-contained HTML the
  [static export](static-export.md) writes, which calls a triplestore with no
  sqlib in the request path.
- **Copy the library's bundle JSON** — the compiled bundle that page runs on.

A cell that has run also offers **Save as test…**: hold a query, its arguments
and a result and you are holding a test case. It records the call that *ran* —
a slot fed from a value was filled with rows the cell no longer shows.

## 7. What is not here yet

- No server-side notebook entity: a notebook lives in the browser and in the
  file you export. There is no URL to share yet.
- No pass-by-reference: a large value round-trips through the browser rather
  than being captured server-side and passed by id.
- No materialize cell, so graph → query needs a saved graph and a backend.
- No promote-to-query-group.

These are scoped in [the proposal](../proposals/notebook-cells.md).
