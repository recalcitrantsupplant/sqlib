import Fastify from 'fastify';
import { describe, it, expect, vi } from 'vitest';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { createQueryGroupVersionForGroupFlatSchema } from '@sparql-query-lib/contracts/schema';
import { serializerOpts } from '../../src/lib/validator-setup.js';

/**
 * Response serialisation runs through fast-json-stringify, not through the ajv
 * `setupValidator` configures, so the `iri` format the generated contracts emit
 * has to be registered a second time — via the `serializerOpts` passed to
 * `Fastify()`. Without it fastify logged `unknown format "iri" ignored in schema
 * at path …` for every such field and then skipped it, which also left `anyOf`
 * branch selection unable to tell an IRI from any other string (issue #311).
 */
describe('response serializer iri format', () => {
  // ajv logs unknown formats through `console.warn`, so that is where the bug is
  // observable from.
  function captureWarnings() {
    return vi.spyOn(console, 'warn').mockImplementation(() => {});
  }

  const responseSchema = {
    type: 'object',
    properties: {
      // anyOf is what makes fast-json-stringify reach for ajv at all: a bare
      // `format` on a plain string branch never gets compiled.
      id: { anyOf: [{ type: 'string', format: 'iri' }, { type: 'number' }] },
    },
  };

  async function serve(payload: unknown, opts: Record<string, unknown> = {}) {
    const app = Fastify({ logger: false, ...opts });
    app.get('/thing', { schema: { response: { 200: responseSchema } } }, async () => payload);
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/thing' });
    await app.close();
    return response;
  }

  it('compiles iri-formatted response schemas without warning', async () => {
    const warn = captureWarnings();
    const response = await serve({ id: 'https://example.org/ns#Thing' }, { serializerOpts });
    const logged = warn.mock.calls.flat().join('\n');
    warn.mockRestore();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'https://example.org/ns#Thing' });
    expect(logged).not.toContain('unknown format');
  });

  it('picks the iri branch by the same definition the validator uses', async () => {
    // A fragment IRI is the case `ajv-formats-draft2019` got wrong and the
    // contracts' own `isIri` gets right; both sides now agree on it.
    const accepted = await serve({ id: 'urn:uuid:0d37179e' }, { serializerOpts });
    expect(accepted.json()).toEqual({ id: 'urn:uuid:0d37179e' });

    // …and a string that is not an IRI matches neither branch, instead of
    // slipping through on `type: "string"` alone.
    const rejected = await serve({ id: 'not an iri' }, { serializerOpts });
    expect(rejected.statusCode).toBe(500);
  });

  it('serializes the generated executionNodes contract quietly', async () => {
    // The real thing this was reported against: the flat query-group version
    // response picks an execution node's shape with `anyOf`, and every branch
    // refs an entity schema whose id fields are `format: "iri"`. Serializing one
    // compiled 48 unknown-format warnings before this fix.
    const warn = captureWarnings();
    const app = Fastify({ logger: false, serializerOpts });
    for (const schema of Object.values<unknown>(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    const { executionNodes } = createQueryGroupVersionForGroupFlatSchema.response[201].properties;
    const node = { id: 'urn:uuid:node-1', queryId: 'urn:uuid:query-1', nodeType: 'query' };
    app.post(
      '/query-groups/:id/versions',
      { schema: { response: { 201: { type: 'object', properties: { executionNodes } } } } },
      async (_request, reply) => reply.code(201).send({ executionNodes: [node] }),
    );
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/query-groups/g/versions', payload: {} });
    await app.close();
    const logged = warn.mock.calls.flat().join('\n');
    warn.mockRestore();

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ executionNodes: [node] });
    expect(logged).not.toContain('unknown format');
  });
});
