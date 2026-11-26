`BIND` gives a variable the value of an expression. `VALUES` gives a variable the values that you list.

- `BIND(expression AS ?v)` adds `?v` to each row. `?v` must not already have a value in the group.
- `CONCAT`, `STR`, `IF` and arithmetic such as `2026 - ?opened` make new values from old ones.
- `VALUES ?x { :a :b }` is a small table of rows. It joins with the rest of the pattern like any other pattern.
- `VALUES (?x ?y) { (:a 1) (:b 2) }` gives several variables per row. `UNDEF` leaves a variable unbound in that row.
- Follows [10 Assignment](https://www.w3.org/TR/sparql11-query/#assignment).
