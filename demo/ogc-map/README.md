# OGC API Features map page

A static map page that reads one OGC API Features service. It lists the
collections, builds a filter form from each collection's queryables, and pages
through the items by the `next` and `prev` links.

The browser-only Rail demo serves it at `map/`
(`demo/scripts/build-browser-site.sh`). The page is outside the pnpm
workspace, so a `pnpm install` at the repository root does not fetch MapLibre
or ogc-client. The site build installs them in this directory.

## Which service it opens

| Source | Service |
| --- | --- |
| `?url=<landing page>` | That URL, on any server that sends CORS headers |
| `config.json` beside the page, `{ "service": "<slug>" }` | `<apiBaseUrl>/ogc/<slug>`, with `apiBaseUrl` from the web app's `../config.json` |
| `?service=<slug>` | As above, with this slug |

When `apiBaseUrl` is `browser`, the page starts the sqlib API Worker from
`../sqlib-api/`, as the web app does (`packages/web/src/lib/browserApi.ts`).
The Worker answers each `fetch` to `../api` in this tab.

`?basemap=none` draws the features with no basemap. The default basemap is the
OpenFreeMap Positron style, which loads from `tiles.openfreemap.org`.

## How it fetches

- `@camptocamp/ogc-client` reads the landing page, the collections and the
  queryables.
- The page fetches each items page on the main thread and gives the GeoJSON
  object to MapLibre with `setData`. A URL in a MapLibre source would load in
  MapLibre's Worker, which the in-tab API does not reach.
- A feature with a `colour` or `color` property is drawn in that colour.
  Other features take the colour of their collection.

## The left-hand panel

The panel has three sections, each with a link to its part of the OGC
standard:

- **Collections**: the service's feature collections. The checkbox shows a
  collection on the map, and a click selects it for the two sections below.
- **Queryables**: the selected collection's queryables. A queryable with an
  `enum` in the queryables document is a list of checkboxes, with the counts
  of `x-counts`. Values ticked in one list match any of them, and the lists
  combine with AND. Other queryables are text fields. A change reloads the
  first page at once. "In map view" adds the map's bounds as `bbox`, and
  follows the map as it moves.
- **Features**: the current page, with the `prev` and `next` links.

## The right-hand panel

The panel shows the selected collection's current page in two tabs: Query,
the SPARQL that ran (when the service links it with `rel=describedby`), and
Result, the GeoJSON that came back. Query switches between Template, the
query as stored (`…/sparql/template`), and As run, with the page's arguments
in place. Result switches between GeoJSON and GeoJSON-LD when the collection
has a JSON-LD context. It follows the web app's inspector
(`packages/web/src/components/shared/InspectorPanel.vue`):

- The button beside the tabs collapses the panel to a strip, and expands it.
- The left edge drags to resize the panel. A double-click resets the width.
- Lines wrap by default. The wrap button turns wrapping off.
- The copy button copies the open tab's text.

The width, the collapsed state and the wrap setting are kept in the browser's
`localStorage` under `sqlib.ogcMap.inspect.v1`.

## Build

```sh
cd demo/ogc-map
pnpm install
pnpm build              # writes dist/
node build.mjs <outdir>
pnpm test
```

| File | Size | Gzip |
| --- | --- | --- |
| `map.js` (with CodeMirror) | 1.60 MB | 461 kB |
| `map-worker.js` (MapLibre's Worker) | 0.56 MB | 162 kB |
| `map.css` | 76 kB | 12 kB |

`packages/api/browser/test/map.mjs` checks the page against the Rail demo.
