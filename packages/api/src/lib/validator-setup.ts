/**
 * Shared AJV validator setup with IRI format support
 * Used by both main application and tests
 */

import addFormats from 'ajv-formats';
import addFormats2019 from 'ajv-formats-draft2019';
import Ajv2020, { type Options } from 'ajv/dist/2020.js';
import { isIri } from '@sparql-query-lib/contracts/iri';
import SerializerSelector from '@fastify/fast-json-stringify-compiler';
import type { FastifyInstance } from 'fastify';

type AjvInstance = InstanceType<typeof Ajv2020.default>;

// Create a shared AJV instance to be reused across all validations
// This ensures the draft-2020-12 meta-schema is available for all schemas
// NOTE: Set to null to force recreation (useful during development)
let sharedAjv: AjvInstance | null = null;

/**
 * The ajv configuration fastify validates every request with.
 *
 * Exported so tests can validate against the *real* configuration rather than a
 * copy of it. `coerceTypes` and `useDefaults` both mutate the payload before a
 * handler sees it, so anything reasoning about what a handler receives has to
 * use these exact options or it is reasoning about a different server.
 */
export function createValidatorAjv() {
  return getOrCreateAjv();
}

function getOrCreateAjv() {
  // Always recreate for now to avoid stale instances during test runs
  // TODO: Investigate proper cache invalidation
  sharedAjv = null;

  if (sharedAjv) {
    return sharedAjv;
  }

  sharedAjv = new (Ajv2020 as unknown as new (opts?: Options) => AjvInstance)({
    allErrors: true,
    removeAdditional: false,  // MUST be false - removeAdditional: true breaks anyOf validation
    useDefaults: true,
    coerceTypes: 'array',
    // Strict mode: false allows schemas with $schema references to work
    strict: false,
  });

  // Add standard formats (uri, date-time, etc.)
  (addFormats as unknown as (ajv: AjvInstance) => unknown)(sharedAjv);

  // Add 2019 formats including IRI
  (addFormats2019)(sharedAjv);

  // …then replace that plugin's `iri` with the one definition the contracts
  // package owns and the generated zod leaf refines with. The plugin's pattern
  // rejects any IRI carrying a fragment — `https://example.org/ns#Thing`, the
  // commonest shape there is in RDF — so every IRI-typed field on every entity
  // refused one while the web app sent it. See packages/contracts/src/iri.ts and
  // test/contracts/web-leaf-parity.test.ts (Phase C3, issue #65).
  sharedAjv.addFormat('iri', isIri);

  return sharedAjv;
}

/**
 * The `serializerOpts` the fastify instance must be constructed with.
 *
 * Response serialisation does not go through the validator ajv above: fastify
 * hands response schemas to fast-json-stringify, which builds an ajv of its own
 * (for `anyOf`/`oneOf`/`if` branch selection) and knows nothing of the formats we
 * registered here. So every `format: "iri"` in a generated response contract
 * logged `unknown format "iri" ignored in schema at path ...` at compile time and
 * was then skipped, leaving branch selection to pick on `type: "string"` alone.
 *
 * fast-json-stringify spreads `serializerOpts.ajv` into those ajv options, so
 * handing it the same `isIri` the validator uses gives one definition of an IRI
 * on both sides of a request. There is no post-construction hook for this —
 * fastify reads `serializerOpts` when it builds the serializer compiler factory —
 * so it has to be passed to `Fastify()` itself. See issue #311.
 */
export const serializerOpts = {
  ajv: {
    formats: {
      iri: isIri,
    },
  },
};

/**
 * Sets up the AJV validator compiler with IRI format support
 */
export function setupValidator(app: FastifyInstance): void {
  const ajv = getOrCreateAjv();

  app.setValidatorCompiler(({ schema }) => {
    // Remove $schema and $id properties if present to avoid issues
    // - $schema: AJV 2020 already knows how to handle draft-2020-12 schemas
    // - $id: Prevents duplicate schema registration when same schema is used in multiple routes
    if (schema && typeof schema === 'object') {
      const { $schema, $id, ...cleanSchema } = schema as Record<string, any>;
      return ajv.compile(cleanSchema);
    }
    return ajv.compile(schema);
  });
}

/**
 * Sets up a response serialiser that compiles each route's schema on that
 * route's first response rather than at `ready()`.
 *
 * Fastify's default is to build a `fast-json-stringify` serialiser for every
 * response schema on every route while the server is coming up. That is the
 * single largest term in this server's startup: measured on a 135-route
 * instance it is ~890ms of the ~1.4s `ready()` takes, and it scales linearly
 * with the route count (~10ms per route) whether or not anything ever calls
 * those routes. For a scale-to-zero deployment, where a cold start sits in
 * front of a user request, that is most of the wait.
 *
 * Deferring it moves the cost to the first response on each route — ~2ms there,
 * once — and a process that only ever serves `/health` never compiles the other
 * 134. Nothing else changes: the same compiler, the same options and the same
 * external-schema bucket produce the same serialiser, just later.
 *
 * **The external schemas are the part that has to be right.** Fastify normally
 * hands the factory `app.getSchemas()` itself, so a serialiser built without
 * them resolves no `$ref` and every entity route answers 500. They are read
 * here inside the compiler callback rather than at setup time because
 * `addSchema` has not run yet when this is called — by first response it has.
 *
 * Must be called before any route is registered, and on the same instance the
 * routes are registered on: a serialiser compiler is per encapsulation context.
 */
export function setupLazySerializer(app: FastifyInstance): void {
  let compile: SerializerSelector.SerializerCompiler | null = null;

  app.setSerializerCompiler((routeDefinition) => {
    let serialize: SerializerSelector.Serializer | null = null;

    return (data) => {
      if (!serialize) {
        if (!compile) {
          // The same factory fastify would have used, with the same options —
          // see `serializerOpts` above for why `ajv.formats.iri` matters here.
          compile = SerializerSelector()(app.getSchemas(), { ...serializerOpts });
        }
        serialize = compile(routeDefinition as SerializerSelector.RouteDefinition);
      }
      return serialize(data);
    };
  });
}
