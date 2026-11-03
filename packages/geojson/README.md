# @sparql-query-lib/geojson

SPARQL JSON SELECT results as GeoJSON (RFC 7946). No dependencies, so the API,
the browser runtime and the web app share it.

- `toFeatureCollection(results, options)`: one feature per row. Returns
  `{ ok: true, collection }` or `{ ok: false, reason, detail }`; it does not
  throw on bad data.
- `parseWkt(text)`: the seven simple feature types, with Z, M and ZM.
- CRS: none, CRS84 and CRS84h are kept; EPSG:4326, 4283 (GDA94) and 7844
  (GDA2020) have their axes swapped. Anything else is refused. Nothing is
  reprojected.

`private: true`; not published. Design: `docs/proposals/ogc-api-features.md`.
