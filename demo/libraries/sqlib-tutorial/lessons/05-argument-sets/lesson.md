An argument set is a saved, named argument for a query. Each run, test and benchmark can use it by name.

- It holds rows for the query's `VALUES` parameters, and values for its `LIMIT` and `OFFSET` parameters.
- It is saved with versions, like a query. A test names one version of it, so the test does not change when someone edits the set.
- One set can fill some parameters and leave the others open. A run can add values for the open ones.
- A query can name one set as the one that the web application selects when the query opens.
- Each exercise in these lessons is a test, and each of its cases names an argument set.
