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
 * `contract-routes.ts` is NOT re-exported here. It is a second, independent
 * description of five of these same entities, and the two disagree — see the
 * header of that file. Merging them into one namespace registers two schemas
 * under one `$id`. Import it explicitly from `@sparql-query-lib/contracts/schema/routes`.
 */
export * from './index.generated.js';
