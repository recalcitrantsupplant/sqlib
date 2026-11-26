This query has the zone written into a `FILTER`. **Make `?zone` a parameter**, so that a run chooses the zones. Return `?name` and `?zone`.

The check runs your query twice: once with the argument *Zones 1 and 2*, and once with no argument, which must return every station.
