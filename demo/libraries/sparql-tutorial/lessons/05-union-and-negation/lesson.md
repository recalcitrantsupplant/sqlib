`UNION` gives the rows of either pattern. `MINUS` and `FILTER NOT EXISTS` remove rows.

- `{ A } UNION { B }` returns the rows that match A and the rows that match B.
- `FILTER NOT EXISTS { P }` keeps a row when P has no match for it. `FILTER EXISTS` keeps it when P has a match.
- `MINUS { P }` removes a row when it shares a variable with a match of P, with the same value.
- The two forms of negation give the same result when the patterns share variables. When they share none, `MINUS` removes nothing.
- Follows [7 Matching Alternatives](https://www.w3.org/TR/sparql11-query/#alternatives) and [8 Negation](https://www.w3.org/TR/sparql11-query/#negation).
