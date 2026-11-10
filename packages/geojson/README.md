# @sparql-query-lib/geojson

Converts SPARQL JSON SELECT results to GeoJSON (RFC 7946). It has no
dependencies, so the API, the browser runtime and the web app share it.

- `toFeatureCollection(results, options)` makes one feature for each row. It
  returns `{ ok: true, collection }` or `{ ok: false, reason, detail }`, and
  does not throw on bad data.
- `parseWkt(text)` reads the seven simple feature types, with Z, M and ZM.
- CRS: the package keeps no CRS, CRS84 and CRS84h as they are. It swaps the
  axes for EPSG:4326, 4283 (GDA94) and 7844 (GDA2020). It refuses all other
  CRSs. It does not reproject.

The package is `private: true`, and is not published. The design is in
`docs/proposals/ogc-api-features.md`.
