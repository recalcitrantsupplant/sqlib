/**
 * Route and response schemas snapshotted from the retired zod round-trip.
 *
 * **No duplicate `$id`s remain.** This file used to redeclare five documents the
 * entity model also emits — `backend`, and the four benchmark ones — so whichever
 * fastify registered first decided what every `$ref` naming them meant. B2
 * collapsed `backend`; the benchmark four followed, and the entity-model
 * documents are what `routes/benchmarks.ts` registers now.
 *
 * Which one won was never stated, only warned about. It was the entity model:
 * `index.ts` registers every entity document at boot, before routes load, and
 * `routes/benchmarks.ts` only registered a snapshot document if its `$id` was
 * still free. So the five removed here were dead — no response changes, and the
 * ambiguity is gone rather than resolved by boot order nobody had checked.
 *
 * Kept here on a separate entry point from the hub barrel: what is left has no
 * entity behind it — the benchmark *route* schemas, the three request bodies
 * (detection, execution, playground), `POST /sparql`, and the response
 * envelopes. Those describe a wire protocol, so there is nothing to collapse
 * them onto.
 */
export * from './contract-routes.js';
