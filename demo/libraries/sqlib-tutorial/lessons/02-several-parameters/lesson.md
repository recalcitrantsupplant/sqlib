A query can declare more than one parameter, and one parameter can hold more than one variable.

- `VALUES (?from ?to) { (UNDEF UNDEF) }` is one parameter of two variables. Each row of its argument is a pair, such as Airport and Central.
- Two `VALUES … { UNDEF }` clauses are two parameters. A run can fill one, both or neither.
- A variable that a row leaves out is `UNDEF` in that row, so it matches anything.
- To make a filter optional, test whether the parameter has a value: `FILTER(!BOUND(?before) || ?opened < ?before)`.
