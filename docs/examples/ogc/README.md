# OGC API Features starter sets

Two collections with the same features and columns
(`?feature ?geom ?name ?height`), one for each mode. See
[guides/publishing-ogc-collections.md](../../guides/publishing-ogc-collections.md).

| Folder | Mode | Runs on |
| --- | --- | --- |
| [`plain`](plain) | `values` | any SPARQL backend, Oxigraph included |
| [`jena`](jena) | `cql2` | Jena Fuseki with the Kurrawong Lucene index |

Each folder has the query (`buildings.rq`) and its `ogc` object
(`buildings.ogc.json`). `plain/buildings.ttl` is five buildings to load into a
store. CI serves the plain set to the OGC CITE suite
(`scripts/ci/ogc-cite.sh`).

For the Jena set:

1. Set `text:exposeConfig true` on the index.
2. Save `jena/index-fields.rq` as a query in the same library.
3. Put that query's id in `cql.configQuery` of `jena/buildings.ogc.json`.
4. Store `name` and `buildingHeight` on the indexed shape
   (`idx:stored true`), so that `luc:fields` can read them.
