A query finds the parts of the data that match a pattern. Each match is one row of the result.

- A triple pattern has a subject, a predicate and an object. A name that starts with `?` is a variable, and matches any term.
- `SELECT` names the variables to return. `SELECT *` returns all of them.
- `PREFIX : <https://example.org/rail/>` lets you write `:Station` in place of `<https://example.org/rail/Station>`.
- `a` is short for `rdf:type`. A `;` starts a new pattern on the same subject, and a `,` a new object for the same subject and predicate.
- Follows [2 Making Simple Queries](https://www.w3.org/TR/sparql11-query/#basicpatterns) and [4 SPARQL Syntax](https://www.w3.org/TR/sparql11-query/#sparqlSyntax).
