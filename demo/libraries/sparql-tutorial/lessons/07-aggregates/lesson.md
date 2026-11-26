An aggregate makes one value from a group of rows.

- `GROUP BY ?x` puts the rows with the same `?x` in one group. The result has one row per group.
- `COUNT`, `SUM`, `MIN`, `MAX`, `AVG`, `SAMPLE` and `GROUP_CONCAT` compute one value per group: `(COUNT(?s) AS ?n)`.
- With `GROUP BY`, `SELECT` can only name the group keys and aggregates.
- `HAVING` is a filter on groups, after they are computed.
- Follows [11 Aggregates](https://www.w3.org/TR/sparql11-query/#aggregates).
