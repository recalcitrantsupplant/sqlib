# Notebooks: prose, cells and named results

A **notebook** is a document that you write about a library. It has prose and
runs, in the order you choose, and binds the result of each run to a name that
the cells below can use. It is the front page of the library: the first entry on
the rail, at `/notebook`. It replaced a screen that showed each query of the
library as a cell, whether or not anyone asked for it. You import entities from
the library, and write prose around them.

The sidebar lists notebooks, as it lists the other entries of the rail. sqlib
stores them in the same way as a query:

- **Scratch.** **+ New** makes a notebook that lives only in this browser and
  autosaves as you type. **Save** writes it to the library as v1.
- **Saved.** A `Notebook` in the library, with immutable numbered versions
  (`/notebooks` in the API). When you type, the browser saves a draft over the
  saved version. It never makes a version. **Save** makes a version, and
  **Discard** restores the saved version. The address names the notebook
  (`/notebook?library=…&notebook=…`), so you can link to a saved notebook. The
  grants of its library decide who can read, save or delete it, as for each
  other library entity.

You can also move a notebook as a file. See section 4.

## 1. What a cell is

A notebook starts empty. **Add** offers four kinds:

| Kind | Holds | Runs through |
| --- | --- | --- |
| Markdown | prose, headings, links, lists | nothing |
| Query | a query reference, plus its arguments | `POST /execute` |
| Query group | a group reference | `POST /execute` |
| Rule set | a rule set reference, plus a base graph | `POST /rule-sets/:id/execute` |

A run cell has the same run sentence as the query screen, without the "with"
clause, because the arguments of a notebook are the cells above. Two parts
remain, and each cell sets them:

- **against**: the store this cell runs against. The default is the store of
  the library.
- **as**: the format of the result.

A usual notebook reads from a warehouse in one cell, then reasons over an
ephemeral copy in the next. A rule set cell has neither part. It runs in the
server process over the graph it receives.

A new notebook opens the Details tab with its name selected, so you can name it
first. If you do not, it uses the first heading of its first markdown cell as its
name.

Working with cells:

- **Move a cell:** drag the handle to the left of the cell. With the keyboard,
  focus the handle and press the arrow keys, or press Alt+Up or Alt+Down
  anywhere in the cell outside a text editor.
- **Finish a markdown cell:** press Done, Esc or Ctrl+Enter, or click outside
  the cell.
- **Rebuild values after a reload:** a reload clears the values. Choose
  **Run all cells up to here** in the menu of a cell to run each cell from the
  top down to that one.
- **Name a value:** the notebook refuses a name that is not valid or that
  another cell uses, with a message next to the box. Esc restores the old name.
- **LIMIT and OFFSET:** a parameter is named by the digits written in the
  query (`LIMIT 0001` is parameter 1). An empty box runs that number.
- **Run status:** the outline shows each cell as ran, stale, incomplete,
  failed or skipped.

A rule-set cell takes its base graph from a graph value above it, or from a
saved data graph in the library. Its value is the triples that the rules infer,
without the base graph. To keep both, merge them in a query cell that runs over
the two graphs (section 3). A rule set that stops at its iteration limit or on a
cycle still binds its value. The cell shows a warning, and **Run all** stops
there.

On a phone, the button at the left of the header opens the notebook list. The
outline and the values are below the document.

Each cell runs through the REST API. A rule-set cell therefore works here, but
an [export bundle](static-export.md) cannot contain one. A bundle calls a
triplestore with no sqlib in the request path, so it contains only compiled
queries and groups that chain SELECTs.

A cell **references** an entity, and follows its current version. It never
holds a copy of the query text. Edit is a link to the editor, so you can give a
notebook to a person who cannot write to the library.

## 2. Values

Each run binds its result to a name: `out1`, `out2`, and so on. You can rename
it in the cell, and the notebook updates the references. A value has one of
three types, and the type decides where it can go next:

| Type | From | Stat chip |
| --- | --- | --- |
| Rows | SELECT, a group ending in one | `1,204 rows · 4 cols · 88 KB` |
| Graph | CONSTRUCT, DESCRIBE, a rule set | `18,332 triples · 2.1 MB` |
| Boolean | ASK | `true` |

Values are kept in the browser session only. The notebook stores the document
and no results, so when you open it again, its cells have not run. A Jupyter
notebook with cleared outputs works in the same way.

**Save** turns a value into a library entity. A graph becomes a
[data graph](../concepts.md) version. Rows become a tuple set version (source
format `query-results`). Use this when a value from an experiment becomes an
input that other entities use.

## 3. Chaining

A value bound **above** a cell can fill a parameter slot of that cell. Pick the
value in the source control of the slot. The notebook pairs the columns with the
variables of the slot by name where the names are equal, and by position for
the rest. A [query group](query-groups.md) edge uses the same rule, so a chain
has the same meaning in both places.

Under a connected slot, the cell shows the pairing: one row for each variable of
the slot, for example `?s ← @out1.?s`. A note lists the columns that no variable
takes (`not passed: ?p ?o`). These columns go no further than this cell.

To change the pairing, pick another column for a variable. Any column can fill
any variable, so `?s` can take `@out1.?o`. Pick **nothing (unbound)** to leave
the variable unbound. The slot saves the choices as `columns`, keyed by the
variable. **Match by name** removes the choices. Before the upstream cell runs,
the control lists the columns that its query projects. A group made with
Promote keeps the pairing, but refuses a variable left unbound.

Set what happens when the upstream is empty: skip this cell (the default), run
with no rows, or stop.

What each connection can carry:

- **Rows to a parameter slot.** Supported.
- **Graph to the base graph of a rule set.** Supported. The notebook sends the
  triples as `dataGraphInline`.
- **Graph to a query.** Supported. Press **Run over a graph** on a query cell,
  and pick a graph value above. The query then runs over those graphs only. The
  server loads them into one ephemeral store, and uses no backend. The graphs go
  into the default graph of the store, so two graphs give their union, and a
  `CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }` query merges them into one value.
  A notebook with such a cell cannot become a query group, because the query
  node of a group runs against a backend.

Chaining is **by value**. A result comes back to the browser, and the browser
sends it in the next request. A large value (64 KiB or more) works differently.
When a cell below reads the result of a cell, the run asks the server to keep a
copy for a short time. The next request names that copy, and does not send the
content again. The server keeps the copy in memory only, for the user who ran
the cell only, for 15 minutes after its last use. If the copy is gone, for
example after a restart, the notebook sends the content, with no action from
you.

Do not use a notebook for production. Put a pipeline that others depend on in a
query group. The server runs a group in one call, with no browser in the path.

When you run a cell again, the notebook marks the cells below it **stale**. It
does not run them. The mark tells you that their results came from an older
input, and you decide what to run.

## 4. Sharing a notebook

A saved notebook is shared by its link. Anyone who can read the library opens
it at its current version.

**Export** writes a `.sqlibnb` file: a small JSON document with the title, the
library it names, and the cells. It contains no results. You can keep it in git
next to the library, and a changed argument is a one-line diff.

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

**The file contains the notebook only.** The entities it names stay in the
library. A file therefore works for a person who has the library: on the same
server, a replica, or an instance with the same library. A cell whose entity is
missing shows as a broken reference.

## 5. Versions

By default, a cell follows the current version of its entity, so a notebook
stays current with its library. A cell can pin a version (`"version": 3` on the
cell). Use a pin for a notebook that belongs to a release.

## 6. Exports

**Export** saves the file of the notebook (`.sqlibnb`). The exports of the
library (the bundle that the [`sqlib` CLI](cli.md) runs, and the runnable page)
are on the main page. See [Exporting a library](static-export.md#from-the-web-app).

A cell that has run also offers **Save as test…**. A query, its arguments and a
result make a test case. The test records the call that *ran*, including the
rows that a value put into a slot, which the cell no longer shows.

## 7. Promote to a query group

**Promote to group** writes the run cells of the notebook as one
[query group](query-groups.md): the same chain, which the server runs in one
call with no browser in the path. Use it when other people start to depend on a
notebook as a pipeline.

- Each cell is pinned to the version it uses now. Markdown cells become the
  description of the group. The notebook does not change.
- A connection from a value to a slot becomes a `VARIABLE_BINDINGS` edge that
  carries the columns that the notebook paired, so the group pairs them in the
  same way. A graph sent to a rule set becomes an `RDF_GRAPH` edge.
- The result of the last run cell is the result of the group.

Before you confirm, the dialog lists what the group does not keep:

- Typed values. The slot becomes a parameter of the group, filled at each run.
- LIMIT and OFFSET values.
- "Skip this cell if empty". It becomes "match nothing", because a group node
  always runs.

Promote refuses a notebook that cannot be a group, and names the cell. The
causes are:

- a run cell whose value no cell below uses (a group returns one result);
- a group cell (groups do not nest);
- a rule set that reads a saved data graph;
- a reference to a value that no cell above binds.

## 8. Not built yet

- `.ipynb` and HTML export.

[The proposal](../proposals/notebook-cells.md) describes the scope.
