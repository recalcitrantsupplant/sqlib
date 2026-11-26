A dataset holds a default graph and any number of named graphs. `GRAPH` matches patterns in a named graph.

- In the Rail store, the network is in the default graph. Each timetable is a named graph: `<https://example.org/rail/timetable/weekday>` and `<https://example.org/rail/timetable/weekend>`.
- A pattern outside `GRAPH` matches the default graph only.
- `GRAPH <iri> { … }` matches in one named graph. `GRAPH ?g { … }` matches in each of them, and binds `?g` to the graph's name.
- `FROM` and `FROM NAMED` choose the dataset for one query.
- Follows [13 RDF Dataset](https://www.w3.org/TR/sparql11-query/#rdfDataset).
