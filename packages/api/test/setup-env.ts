// Defaults only — an already-set value wins, so a suite can be pointed at a real
// SPARQL endpoint without editing this file. That is how the self-hosted
// persistence adapter gets exercised against the `http` backend (with basic auth)
// as well as in-process oxigraph; see test/persistence/README-http-backend.md.
process.env.INTERNAL_BACKEND_TYPE ||= 'oxigraph-memory';
process.env.CACHE_WRITE_THROUGH ||= 'false';
process.env.LIBRARY_STORAGE_SPARQL_ENDPOINT ||= 'http://example.org/sparql';
