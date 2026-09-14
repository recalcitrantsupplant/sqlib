# Prefixes

The Prefix Manager keeps a registry of prefix-to-namespace mappings in the browser
and uses it to abbreviate IRIs in result tables and to rewrite a whole document
between full IRIs and prefixed names.

It is entirely browser-side. The registry lives in `localStorage` under
`sparqlQueryLib.prefixSettings`, and nothing about it is stored on the server or
shared between browsers. The one exception is syncing with a backend's own prefix
map, which proxies through the API because the browser cannot reach the store
directly; even then, the result is written back into the same local registry.

## Turning abbreviation on and off

"Abbreviate IRIs" is a display setting, stored separately in
`sparql-query-lib-settings` under `prefixAbbreviationEnabled`. It is **on by
default**. Open **Settings**, find **Result tables**, and toggle **Abbreviate
IRIs** to show the full IRI everywhere instead.

The setting governs the default term display in result tables. It does not govern
the registry: the abbreviation cache is built from the mappings alone, so a column
switched explicitly to prefixed names abbreviates whatever the default says, and
the whole-document conversions work either way.

A `showTooltips` setting, on by default, reveals the full IRI as a `title` on an
abbreviated term.

## The registry

Every mapping carries a `prefix`, a `namespace`, an `enabled` toggle, and a
`source` recording where it came from:

| `source` | Meaning |
| --- | --- |
| `default` | One of the 19 built-in mappings — `rdf`, `rdfs`, `owl`, `xsd`, `foaf`, `dc`, `dcterms`, `skos`, `sh`, `schema`, `sdo`, `geo`, `geof`, `time`, `void`, `prov`, `dbr`, `dbo`, `dbp`. All enabled. |
| `auto-discovered` | Read out of a document or a response. |
| `user-added` | Typed into the editor. |
| `endpoint` | Pulled from a backend's own prefix map. |

An auto-discovered mapping also carries `discoveredFrom`, the provenance token
described below. A mapping that came from or was reconciled with a store carries
`syncedWith`, the backend a later sync matches it against.

Defaults are merged in on load, so a new built-in prefix appears in a registry
written by an older build. The merge identifies a mapping by its prefix and
namespace together rather than by its id, which also heals storage written by a
build whose "reset to defaults" minted fresh ids and doubled every row.

### Managing mappings

Open **Prefix Manager** from Settings. Rows can be added, edited, enabled and
disabled individually, and deleted. The filter box searches prefix and namespace,
and a conflicts button appears when the registry holds any, filtering the list to
them.

The overflow menu offers:

- **Sync with endpoint…** — see below.
- **Reset to defaults** — restore the built-in set.
- **Export as VANN** and **Export as RDFa** — download the mappings as Turtle
  (`prefixes-vann.ttl`, `prefixes-rdfa.ttl`).

### How conflicts are resolved

Two mappings sharing both a prefix and a namespace are redundancy and the
duplicate is dropped on load. Sharing one of the two is a conflict, reported in
the editor, and resolved for display like this:

1. **Longest namespace wins a prefix.** If `ex:` is bound to both
   `http://example.org/` and `http://example.org/vocab/`, the longer binding is the
   one that is effective.
2. **A namespace with several prefixes keeps one.** A default beats a non-default;
   otherwise the mapping added first wins.

Abbreviation itself is a greedy longest-match over the effective namespaces, so
with `ex:` → `http://example.org/` and `ex-vocab:` → `http://example.org/vocab/`
both effective, `http://example.org/vocab/term` abbreviates to `ex-vocab:term`.

A namespace that ends in neither `/` nor `#` and that contains a `/` or a `.` has a
trailing `/` added when it is stored, so `http://example.org` and
`http://example.org/` are the same mapping.

## Auto-discovery

Discovery is a property of an editor rather than of a screen. `usePrefixDiscovery`
takes the text and a token saying where the text lives, and registers the
declarations it finds once typing pauses (800 ms by default). `CodeEditor`,
`SparqlEditorPanel` and `EditableRdfViewer` all call it, so every panel built from
them discovers by construction — queries, rule sets, tests, data graphs, tuple sets
and the ETL SPARQL template alike. Passing no source at all turns discovery off,
for boxes holding JSON or prose.

One expression reads every declaration form the RDF family uses — SPARQL's
`PREFIX foaf: <…>` and Turtle's `@prefix foaf: <…> .` — so a rule set, a data
graph, a query and a response are all read the same way. For SPARQL,
`autoDiscoverFromSparql` parses first and falls back to that scan, because a
half-typed query is the normal state of an editor and the PREFIX block above the
fault is complete regardless.

Responses discover too, against a `results:<backend id>` token. A store serialises
a CONSTRUCT with its own prefix map, and the same query answered by two endpoints
can come back with two different maps.

Query versions discover when they arrive rather than when they are displayed. A
version list behind the history dropdown, a group node previewing the query it
calls, a test or argument set resolving the version it runs, either side of a
version diff — `lib/queryVersionPrefixes.ts` reads the query text out of whichever
shape a version endpoint answered with, and `useApiClient` calls it on every
query-version response. Re-registering a mapping already held is a no-op, so the
repeated reads a list makes cost only the scan.

A discovered mapping is added enabled. A declaration is recorded only when no
mapping already holds that exact prefix and namespace; a prefix bound to a
*different* namespace is added as a second mapping, and the conflict rules above
decide which is effective. A prefix the manager would refuse from a person — one
that does not match `[A-Za-z_][A-Za-z0-9_-]*` — is refused from a document too, as
is a namespace that is not an IRI, and the empty prefix of `PREFIX : <…>` is
matched only so that it is consumed rather than half-matched.

### Provenance

`lib/prefixSources.ts` defines one token shape, `<kind>:<id>`, where kind is one of
`query`, `query-group`, `rule-set`, `test`, `benchmark`, `etl`, `data-graph`,
`tuple-set`, `results` or `endpoint`. The manager shows the kind — Query, Rule set,
Data graph — with "(draft)" as a qualifier when the item has no server identity
yet, and links to it either way: an unsaved item is addressable by its scratch id
(`urn:ui-temp:…`), so there is no reason to drop the link. Tokens written by older
builds are still read, so an existing registry does not degrade to raw text.

## Syncing with an endpoint's prefix map

If a backend keeps its own prefix map, the manager can reconcile with it. Open the
overflow menu and choose **Sync with endpoint…**, then pick a backend. Each is
labelled with what it can do:

- **read/write** — an Apache Jena Fuseki dataset whose configuration declares both
  a `prefixes` and a `prefixes-rw` endpoint. All three directions are available.
- **read-only** — only the read endpoint is declared, so you can pull but not push.
  Adding a read-write prefixes endpoint is a change to the dataset's Fuseki
  configuration, not something the app can do for you.
- **no prefix service** — nothing to sync with. For non-Jena stores the app still
  tries to read prefixes out of the store's own Turtle output, which works when the
  data was loaded with prefixes.
- **not probed yet** — run **Test connection** on the backend first.

The browser reaches the store through two API routes rather than directly:
`GET /backends/:id/prefixes` reads the store's map and requires `use` on the
backend, the same bar `Test connection` clears; `POST /backends/:id/prefixes`
pushes and requires `write`, because it mutates someone else's dataset
configuration.

### Directions

- **Pull** takes the store's prefixes: new ones are added, and disagreements are
  resolved in the store's favour. A default prefix (`rdf:`, `owl:`, …) is never
  rewritten in place — the store's version is added beside it instead.
- **Push** sends your mappings to the store. Disabled mappings, mappings shadowed
  by another with the same prefix, and by default the built-in defaults are left
  out; the preview lists everything it skipped and why.
- **Both ways** merges. Anything only one side changed is applied automatically;
  anything both sides changed is raised as a conflict to settle — **Keep local**,
  **Take remote**, **Keep both** (which keeps the store's value and renames yours
  to `prefix-1`), or **Skip**. Nothing is applied until every conflict has an
  answer.

Either one-way direction also offers a **mirror** option, which additionally
removes what the other side does not have. That is the only destructive choice
here, it is off by default, and it confirms first — and a mirrored pull never
removes a default.

Nothing is applied until you have seen the full preview and pressed Apply. Fuseki's
prefix service is one call per prefix with no transaction across them, so a push is
applied one prefix at a time and the store can refuse individual ones; the result
lists exactly what landed and what did not.

Each backend gets a **baseline** in `localStorage`, under
`sparqlQueryLib.prefixSync.<backend id>`, recording what the store held when the
last sync finished. That is what lets "both ways" tell a change from a
disagreement. It is per browser, because another machine syncing the same store has
its own history. A corrupt or missing baseline is not an error: the planner falls
back to judging differences on their values alone.

## Elsewhere in the app

- **Result tables** abbreviate matching IRIs when the setting is on, with the full
  IRI in a tooltip. Copying a cell copies the full IRI, so pasting elsewhere stays
  correct, and an IRI that did not abbreviate offers to add a mapping for it in
  place.
- **Editors** have a toolbar that converts a whole document in either direction —
  full IRIs to prefixed names, or the reverse. The conversion walks the Lezer syntax tree the editor has
  already built, so an IRI inside a string literal, inside a comment, in a
  `PREFIX` declaration, or a blank node label is left alone. A language the app has
  no grammar for converts nothing and says so rather than offering an approximate
  rewrite.

## When an IRI does not abbreviate

- Check that the namespace in the registry is exactly a prefix of the IRI,
  including the trailing `/` or `#`.
- Check that the remaining local name is a legal one — it cannot start with a digit
  or contain characters SPARQL's `PN_LOCAL` production disallows.
- Check that the mapping is enabled, and that it is the effective one: another
  mapping with the same prefix and a longer namespace, or the same namespace and an
  older or default mapping, will have won.
