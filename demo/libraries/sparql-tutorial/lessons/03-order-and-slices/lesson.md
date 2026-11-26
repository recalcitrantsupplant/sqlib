Solution modifiers change the rows after the patterns match.

- `ORDER BY ?x` sorts the rows. `ORDER BY DESC(?x)` sorts them from the largest. Give more keys to break ties.
- Without `ORDER BY`, the order of the rows is not defined.
- `DISTINCT` removes rows that repeat.
- `LIMIT n` keeps the first n rows. `OFFSET n` skips the first n rows. Use them with `ORDER BY`, so that "first" has a meaning.
- Follows [15 Solution Sequences and Modifiers](https://www.w3.org/TR/sparql11-query/#solutionModifiers).
