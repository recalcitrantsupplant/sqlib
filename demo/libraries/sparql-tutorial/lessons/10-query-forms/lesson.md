`SELECT` returns rows. The other three query forms return other things.

- `ASK` returns true when the pattern has a match, and false when it has none.
- `CONSTRUCT { template } WHERE { pattern }` returns a graph: the template's triples, once for each match.
- `DESCRIBE <iri>` returns a graph about a resource. Which triples it holds is for the store to decide.
- Follows [16 Query Forms](https://www.w3.org/TR/sparql11-query/#QueryForms).
