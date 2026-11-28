# OGC API Features map page

A static map page that reads one OGC API Features service. It lists the
collections, builds a filter form from each collection's queryables, and pages
through the items by the `next` and `prev` links.

The browser-only Rail demo serves it at `map/`
(`demo/scripts/build-browser-site.sh`).

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

## Build

```sh
pnpm --filter @sparql-query-lib/ogc-map build [outdir]   # default: dist/
```

| File | Size | Gzip |
| --- | --- | --- |
| `map.js` | 1.24 MB | 337 kB |
| `map-worker.js` (MapLibre's Worker) | 0.56 MB | 162 kB |
| `map.css` | 75 kB | 11 kB |

`packages/api/browser/test/map.mjs` checks the page against the Rail demo.
