sqlib saves a query as a name and a history of versions. The text is in the versions.

- A *query* holds a name, a description, tags and a default backend. It holds no SPARQL text.
- A *version* holds the text. A saved version never changes. To change the text, you save a new version, and it becomes the query's current version.
- A run, a test or an environment can name one version, so it gives the same answer after someone changes the query.
- sqlib reads the parameters of each version when it is saved.
- Choose a version from **Version** under the editor to see how this query changed.
- This demo is read-only. Where writes are allowed, save a version with **Save** in the query editor, or with `queries_createVersion` over MCP.
