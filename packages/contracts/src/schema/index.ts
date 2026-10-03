/**
 * The JSON Schema hub: entity schemas and the route schemas derived from them.
 *
 * Everything here is JSON Schema (plus types inferred from it) — no zod, and
 * nothing that converts between the two. That conversion (`produceJsonSchema`)
 * was deleted when schema generation was consolidated.
 *
 * Lives in `contracts` rather than `api` because the API, the MCP server and the
 * web app all need it, and a hub must be depended on by everything while
 * depending on nothing. `contracts` is the only workspace package that already
 * satisfies that.
 *
 * Imported as `@sparql-query-lib/contracts/schema`, deliberately separate from
 * the package root (which is zod) so a consumer that only wants JSON Schema does
 * not pull zod into its graph.
 *
 * The hand-written route schemas (`hand-written/contract-routes.ts`) are NOT
 * re-exported here. The API registers every `$id`-carrying export of this barrel
 * at boot, and those documents are registered by the routes that use them
 * instead. Import them from `@sparql-query-lib/contracts/schema/routes`.
 */
export * from './index.generated.js';
