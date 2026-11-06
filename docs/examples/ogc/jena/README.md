# Jena starter set (`cql2` mode)

Runs on Jena Fuseki with the Kurrawong Lucene index.

| File | What it is |
| --- | --- |
| `buildings.rq` | The query: a wrapper around `luc:query`, with properties from `luc:fields` |
| `buildings.ogc.json` | The version's `ogc` object |
| `index-fields.rq` | The `luc:config` query that lists the index fields |

Set `text:exposeConfig true` on the index, save `index-fields.rq` in the same
library, and put its id in `cql.configQuery`. See
[guides/publishing-ogc-collections.md](../../../guides/publishing-ogc-collections.md).
