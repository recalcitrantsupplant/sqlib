A `LIMIT` or an `OFFSET` can be a parameter too, so that one query gives a page of any size.

- `LIMIT 0001` declares a limit parameter named `1`. Three zeros and then a number mark it, and the number is its name.
- `OFFSET 0002` declares an offset parameter named `2`. Give each parameter in a query a different number.
- A run gives each one a value. Under the editor, **LIMIT 0001** and **OFFSET 0002** take the values for this run.
- With no value, the text is unchanged. `LIMIT 0001` is still valid SPARQL, and means a limit of 1.
- An argument set can hold these values too, as the next lessons show.
