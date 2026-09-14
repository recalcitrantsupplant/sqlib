/**
 * Shared AJV validator setup with IRI format support
 * Used by both main application and tests
 */

import addFormats from 'ajv-formats';
import addFormats2019 from 'ajv-formats-draft2019';
import Ajv2020, { type Options } from 'ajv/dist/2020.js';
import { isIri } from '@sparql-query-lib/contracts/iri';
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
