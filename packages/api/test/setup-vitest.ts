import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import addFormats2019 from 'ajv-formats-draft2019';
import { File } from 'node:buffer';

// In-memory internal backend by default. An already-set value wins, so a run can
// be pointed at a real SPARQL endpoint instead — which is how the self-hosted
// persistence adapter gets exercised against the `http` backend as well as
// in-process oxigraph. See test/persistence/README-http-backend.md.
process.env.INTERNAL_BACKEND_TYPE ||= 'oxigraph-memory';

/*
 * The SRL rule-tuples extension, on for the suites that exercise it.
 *
 * A default deployment withholds it (`ruleTuples` defaults off, see
 * `packages/types/src/featureFlags.ts`), but the suites below are testing the
 * extension rather than the default, so turning it on here keeps them testing
 * what they were written to test. The suites that cover the gate itself call
 * `overrideFeatureFlags({ ruleTuples: false })` and assert the refusal — see
 * `test/routes/ruleTuplesGate.test.ts`. A value already in the environment
 * wins, as with the backend above.
 */
process.env.FEATURE_RULE_TUPLES ||= 'true';

if (typeof globalThis.File === 'undefined') {
  globalThis.File = File as typeof globalThis.File;
}

// Configure AJV globally to prevent "unknown format iri" warnings
const ajv = new (Ajv as any)({
  strict: false, // Suppress strict mode warnings
  validateFormats: false, // Don't fail on unknown formats
});
(addFormats as any)(ajv);
(addFormats2019 as any)(ajv);

// Placeholder credentials for the tests that assert on config plumbing. Defaults
// again, so a run against a real endpoint can supply its own.
process.env.LIBRARY_STORAGE_SPARQL_USERNAME ||= 'admin';
process.env.LIBRARY_STORAGE_SPARQL_PASSWORD ||= 'password123';
