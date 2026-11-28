// Loads the DuckDB adapter (`sqlib-duckdb.js`, built from duckdb.mjs) only when
// ETL first uses it, so the API Worker starts without apache-arrow and
// duckdb-wasm.
let loaded = null;
function load() {
  loaded ??= import(/* @vite-ignore */ new URL('./sqlib-duckdb.js', globalThis.location.href).href);
  return loaded;
}
export const DuckDBConnection = { create: async (...a) => (await load()).DuckDBConnection.create(...a) };
export const DuckDBInstance = { create: async (...a) => (await load()).DuckDBInstance.create(...a) };
export const JsonDuckDBValueConverter = {};
export default { DuckDBConnection, DuckDBInstance, JsonDuckDBValueConverter };
