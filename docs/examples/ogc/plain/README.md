# Plain starter set (`values` mode)

Runs on any SPARQL backend, Oxigraph included.

| File | What it is |
| --- | --- |
| `buildings.rq` | The query. Each OGC parameter fills a `VALUES` clause. `LIMIT 0001` and `OFFSET 0002` page it |
| `buildings.ogc.json` | The collection's `ogc` mapping, which a service version lists with the query's id in `query` |
| `buildings.ttl` | Five buildings to load into a store |

See [guides/publishing-ogc-collections.md](../../../guides/publishing-ogc-collections.md).
