# Prefixes

The Prefix Manager keeps a registry of mappings from prefix to namespace in the
browser. It uses the registry to abbreviate IRIs in result tables, and to
convert a whole document between full IRIs and prefixed names.

The Prefix Manager runs only in the browser. The registry is in `localStorage`,
under `sparqlQueryLib.prefixSettings`. The server stores none of it, and other
browsers do not share it. There is one exception: a sync with the prefix map of
a backend goes through the API, because the browser cannot reach the store
directly. The result of the sync still goes into the same local registry.

## Turning abbreviation on and off

"Abbreviate IRIs" is a display setting. It is stored separately, in
`sparql-query-lib-settings` under `prefixAbbreviationEnabled`. It is **on by
default**. Two controls change it, and both write the same value:

- the pair of buttons in the results action bar, next to Download and pop-out;
- **Settings** → **Result tables** → **Abbreviate IRIs**.

The setting applies to all result tables in the browser, and stays after a
reload. It has no effect on the registry. The abbreviation cache is built from
the mappings only, so the document conversions work with the setting on or off.

The `showTooltips` setting, on by default, shows the full IRI as a `title` on an
abbreviated term.

## The registry

Each mapping has a `prefix`, a `namespace`, an `enabled` toggle, and a `source`
that records where it came from:

| `source` | Meaning |
| --- | --- |
| `default` | One of the 19 built-in mappings: `rdf`, `rdfs`, `owl`, `xsd`, `foaf`, `dc`, `dcterms`, `skos`, `sh`, `schema`, `sdo`, `geo`, `geof`, `time`, `void`, `prov`, `dbr`, `dbo`, `dbp`. All are enabled. |
| `auto-discovered` | Read from a document or a response. |
| `user-added` | Typed into the editor. |
| `endpoint` | Taken from the prefix map of a backend. |

An auto-discovered mapping also has `discoveredFrom`, the provenance token
described below. A mapping that came from a store, or was reconciled with one,
has `syncedWith`. This names the backend that a later sync compares it with.

The app merges the defaults in when it loads. A new built-in prefix therefore
appears in a registry that an older build wrote. The merge identifies a mapping
by its prefix and namespace together, and ignores its id. This also repairs
storage from an older build whose "reset to defaults" made new ids and
duplicated each row.

### Managing mappings

Open **Prefix Manager** from Settings. You can add, edit, enable, disable and
delete each row. The filter box searches the prefix and the namespace. When the
registry has conflicts, a conflicts button appears, which filters the list to
them.

The overflow menu has:

- **Sync with endpoint…**: see below.
- **Reset to defaults**: restore the built-in set.
- **Export as VANN** and **Export as RDFa**: download the mappings as Turtle
  (`prefixes-vann.ttl`, `prefixes-rdfa.ttl`).

### How conflicts are resolved

When two mappings have the same prefix and the same namespace, one is a
duplicate, and the app drops it on load. When they share only the prefix or only
the namespace, that is a conflict. The editor reports it. For display, the app
resolves it as follows:

1. **The longest namespace gets the prefix.** If `ex:` is bound to both
   `http://example.org/` and `http://example.org/vocab/`, the longer binding is
   effective.
2. **A namespace with several prefixes keeps one.** A default mapping has
   priority over other mappings. Otherwise, the mapping added first has
   priority.

Abbreviation takes the longest matching effective namespace. With
`ex:` → `http://example.org/` and `ex-vocab:` → `http://example.org/vocab/` both
effective, `http://example.org/vocab/term` becomes `ex-vocab:term`.

When the app stores a namespace that ends in neither `/` nor `#`, and contains a
`/` or a `.`, it adds a trailing `/`. `http://example.org` and
`http://example.org/` are therefore the same mapping.

## Auto-discovery

Discovery belongs to an editor. `usePrefixDiscovery` takes the text, and a token
that says where the text is. When typing pauses (800 ms by default), it
registers the declarations that it finds. `CodeEditor`, `SparqlEditorPanel` and
`EditableRdfViewer` all call it. Each panel built from them therefore discovers
prefixes: queries, rule sets, tests, data graphs, tuple sets and the ETL SPARQL
template. To turn discovery off, pass no source. Do this for boxes that hold
JSON or prose.

One regular expression reads each declaration form of the RDF family: SPARQL
`PREFIX foaf: <…>` and Turtle `@prefix foaf: <…> .`. A rule set, a data graph,
a query and a response are therefore read in the same way. For SPARQL,
`autoDiscoverFromSparql` parses first, and uses the scan if the parse fails. In
an editor, a query is usually half typed, and the PREFIX block above the error
is still complete.

Responses are also read, with a `results:<backend id>` token. A store
serialises a CONSTRUCT result with its own prefix map. Two endpoints can answer
the same query with two different maps.

The app reads query versions when they arrive, and does not wait until they are
displayed. Examples are a version list behind the history menu, a group node
that previews the query that it calls, a test or argument set that resolves the
version that it runs, and both sides of a version diff.
`lib/queryVersionPrefixes.ts` reads the query text from each shape that a
version endpoint returns. `useApiClient` calls it on each query-version
response. A second registration of an existing mapping does nothing, so
repeated reads cost only the scan.

A discovered mapping is added as enabled. The app records a declaration only
when no mapping already has that exact prefix and namespace. A prefix bound to a
*different* namespace is added as a second mapping, and the conflict rules above
decide which one is effective.

The app refuses the same prefixes from a document as from a person:

- a prefix that does not match `[A-Za-z_][A-Za-z0-9_-]*`;
- a namespace that is not an IRI.

The scan matches the empty prefix of `PREFIX : <…>` only so that it reads the
whole declaration.

### Provenance

`lib/prefixSources.ts` defines one token shape, `<kind>:<id>`. The kind is one
of `query`, `query-group`, `rule-set`, `test`, `benchmark`, `etl`, `data-graph`,
`tuple-set`, `results` or `endpoint`.

The manager shows the kind, for example Query, Rule set or Data graph. It adds
"(draft)" when the item has no server identity yet. It links to the item in both
cases, because an unsaved item has a scratch id (`urn:ui-temp:…`). The app still
reads tokens from older builds, so an existing registry keeps its links.

## Syncing with an endpoint's prefix map

If a backend keeps its own prefix map, the manager can reconcile with it. Open
the overflow menu, choose **Sync with endpoint…**, and select a backend. Each
backend has a label that says what it supports:

- **read/write**: an Apache Jena Fuseki dataset whose configuration declares a
  `prefixes` endpoint and a `prefixes-rw` endpoint. All three directions are
  available.
- **read-only**: only the read endpoint is declared, so you can pull and cannot
  push. To add a read-write prefixes endpoint, change the Fuseki configuration
  of the dataset. The app cannot do this.
- **no prefix service**: there is nothing to sync with. For stores that are not
  Jena, the app still tries to read prefixes from the Turtle output of the
  store. This works when the data was loaded with prefixes.
- **not probed yet**: run **Test connection** on the backend first.

The browser reaches the store through two API routes:

- `GET /backends/:id/prefixes` reads the map of the store. It requires `use` on
  the backend, the same as `Test connection`.
- `POST /backends/:id/prefixes` pushes. It requires `write`, because it changes
  the dataset configuration of the store.

### Directions

- **Pull** takes the prefixes of the store. It adds new ones, and resolves each
  disagreement for the store. It never changes a default prefix (`rdf:`, `owl:`,
  …) in place. It adds the version of the store next to it.
- **Push** sends your mappings to the store. It omits disabled mappings,
  mappings hidden by another with the same prefix, and, by default, the built-in
  defaults. The preview lists each omitted mapping and the reason.
- **Both ways** merges. The app applies a change from one side automatically.
  It shows a change from both sides as a conflict, with four choices:
  - **Keep local**;
  - **Take remote**;
  - **Keep both**: keep the value of the store, and rename yours to `prefix-1`;
  - **Skip**.

  The app applies nothing until each conflict has an answer.

Each one-way direction also has a **mirror** option. It also removes what the
other side does not have. This is the only destructive choice here. It is off by
default, and it asks for confirmation. A mirrored pull never removes a default.

The app applies nothing until you see the full preview and press Apply. The
prefix service of Fuseki takes one call for each prefix, with no transaction
across them. A push therefore applies one prefix at a time, and the store can
refuse some of them. The result lists each prefix that was applied and each that
was not.

Each backend gets a **baseline** in `localStorage`, under
`sparqlQueryLib.prefixSync.<backend id>`. It records what the store held at the
end of the last sync. With it, "both ways" can tell a change from a
disagreement. The baseline is local to the browser, because another computer
that syncs the same store has its own history. A corrupt or missing baseline is
not an error. The planner then compares the values only.

## Elsewhere in the app

- **Result tables** abbreviate matching IRIs when the setting is on, with the
  full IRI in a tooltip. A copy of a cell copies the full IRI, so a paste
  elsewhere stays correct. An IRI that did not abbreviate has an option to add a
  mapping for it.
- **Editors** have a toolbar that converts a whole document in either
  direction: full IRIs to prefixed names, or prefixed names to full IRIs. The
  conversion uses the Lezer syntax tree that the editor already has. It does not
  change an IRI in a string literal, in a comment, or in a `PREFIX`
  declaration, or a blank node label. For a language that the app has no
  grammar for, it converts nothing and says so.

## When an IRI does not abbreviate

- Check that the namespace in the registry is exactly a prefix of the IRI, with
  the trailing `/` or `#`.
- Check that the rest of the IRI is a legal local name. It cannot start with a
  digit, or contain characters that the SPARQL `PN_LOCAL` production does not
  allow.
- Check that the mapping is enabled and effective. Another mapping can have
  priority: one with the same prefix and a longer namespace, or one with the
  same namespace that is older or a default.
