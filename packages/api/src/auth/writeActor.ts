/**
 * Who a write is made by, for the `createdBy` and `modifiedBy` stamps
 * (`persistence/authorship.ts`).
 *
 * The stamps are applied where the timestamps are, in `CacheCoordinator`,
 * which knows nothing of requests. Threading the caller through every route,
 * writer and service that ends in a `cache.create` or `cache.update` would put
 * the stamp back in each of them, and the next write path would forget it.
 * So the request is carried in an `AsyncLocalStorage` instead, entered in the
 * request's own hooks, and the coordinator asks this module.
 *
 * Three answers:
 *
 * - **outside any request**: startup, seeding, an import script. The write is
 *   sqlib's own, and the coordinator keeps whatever authorship the entity
 *   already carries (an import restores it);
 * - **a request that identifies someone**: their principal IRI;
 * - **a request that identifies no one** (`disabled` or `anonymous` mode, a
 *   system token, `dry-run` without a token): null. Nobody is recorded, and
 *   a value in the body is not believed either.
 *
 * "Identifies" is `callerIdentityOf`'s rule, the one the `?authUser` slot
 * already follows, so a query and a stamp never disagree about who is calling.
 *
 * A run that outlives its response (a test or benchmark run) keeps the
 * context it started in, so what it writes is stamped with whoever started it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { callerIdentityOf } from './caller.js';
import { authOf } from './enforce.js';

interface WriteScope {
  request: FastifyRequest;
}

const storage = new AsyncLocalStorage<WriteScope>();

/** The answer for a write made outside any request. */
export const NO_REQUEST = Symbol('no-request');

/**
 * The principal a write in the current async context is made by: an IRI,
 * null for a request that identifies no one, or `NO_REQUEST`.
 */
export function currentWriteActor(): string | null | typeof NO_REQUEST {
  const scope = storage.getStore();
  if (!scope) return NO_REQUEST;
  return callerIdentityOf(authOf(scope.request))?.user ?? null;
}

/** Run `fn` as a write made within `request`. For tests and for code with a request but no hook. */
export function runWithWriteRequest<T>(request: FastifyRequest, fn: () => T): T {
  return storage.run({ request }, fn);
}

/**
 * Enter the request's write scope for everything the request runs.
 *
 * `onRequest` enters it for the hooks that follow, the auth plugin's
 * included. `preValidation` enters it again, because the body is parsed from
 * stream events between the two and those do not carry the context — the
 * reason `@fastify/request-context` re-binds at the same point. The handler
 * runs after `preValidation`, so it and everything it awaits are covered.
 *
 * The scope holds the request, not its caller: the auth plugin builds the
 * caller in a later `onRequest` hook, and `currentWriteActor` reads it at
 * write time.
 */
export function registerWriteActorHooks(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    storage.run({ request }, done);
  });
  app.addHook('preValidation', (request, _reply, done) => {
    storage.run({ request }, done);
  });
}
