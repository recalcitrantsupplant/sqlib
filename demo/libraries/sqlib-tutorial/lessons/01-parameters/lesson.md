A parameter is a part of a query that each run fills with different values. In sqlib you declare one in the query text.

- `VALUES ?line { UNDEF }` declares a parameter for `?line`. A `VALUES` clause is a parameter only when its one row is all `UNDEF`. A `VALUES` clause with data is data.
- A run gives the parameter an *argument*: a table of rows for `?line`. The query then matches only those values.
- An argument with two rows, such as the Red and the Green line, gives both lines in one run.
- A run with no argument leaves `UNDEF` in place. `UNDEF` matches anything, so the query returns every line's stations.
- The text stays valid SPARQL, so any store runs it, and a parameter is never pasted into the text as a string.
- Choose an argument from **Arguments** under the editor, then press **Run**.
