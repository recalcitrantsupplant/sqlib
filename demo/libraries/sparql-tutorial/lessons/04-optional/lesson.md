`OPTIONAL` adds data when it is there, and keeps the row when it is not.

- A row that the optional part does not match keeps its other values. The variables of the optional part are unbound in that row.
- `BOUND(?x)` is true when `?x` has a value. `FILTER(!BOUND(?x))` keeps the rows where the optional part did not match.
- In the Rail data, `:next` links each stop to the stop after it, in one direction only. A station at the end of a line can have no `:next`.
- Follows [6 Including Optional Values](https://www.w3.org/TR/sparql11-query/#optionals).
