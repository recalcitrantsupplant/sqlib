/**
 * The `./schema/routes` entry point: the route and response JSON Schemas that
 * have no entity behind them.
 *
 * That is the benchmark *route* schemas, the three request bodies (detection,
 * execution, playground), `POST /sparql`, the patch routes and the response
 * envelopes. They describe a wire protocol, so the entity-model generator has
 * nothing to project them from, and they live in `hand-written/` rather than
 * beside the `*.generated.ts` files in this directory.
 *
 * Kept on a separate entry point from the hub barrel (`./schema`) because the
 * API registers every `$id`-carrying export of the hub at boot; these documents
 * are registered by the routes that use them. No `$id` here may collide with an
 * entity document — `packages/api/test/contracts/route-schema-ids.test.ts`
 * fails if one does, or if a route `$ref`s a document nothing declares.
 */
export * from '../hand-written/contract-routes.js';
