`FILTER` keeps only the rows for which an expression is true.

- Compare with `=`, `!=`, `<`, `<=`, `>` and `>=`. Join tests with `&&` (and), `||` (or) and `!` (not).
- A number in the data, such as `:zone 1`, compares as a number. `:stepFree true` is a boolean, so `FILTER(?stepFree)` is a test on its own.
- `CONTAINS`, `STRSTARTS` and `REGEX` test strings. `LCASE` makes a test ignore case.
- A filter applies to the whole group it is in, wherever you write it in the group.
- Follows [3 RDF Term Constraints](https://www.w3.org/TR/sparql11-query/#termConstraint) and [17 Expressions and Testing Values](https://www.w3.org/TR/sparql11-query/#expressions).
