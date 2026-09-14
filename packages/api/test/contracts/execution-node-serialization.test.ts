import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { getQueryGroupVersionForGroupSchema } from '@sparql-query-lib/contracts/schema';

import { setupValidator, serializerOpts } from '../../src/lib/validator-setup.js';

/**
 * Guard: a group version's `executionNodes` serialize as the kind they are.
 *
 * The response schema declares the array as an `anyOf` of the four node
 * entities, and Fastify serializes an `anyOf` with the **first** branch the
 * value validates against. None of the four sets `additionalProperties: false`,
 * so a branch matches on its `required` list alone and then drops every property
 * it does not itself declare.
 *
 * With the branches in name order `dynamicquerynode` came first, and it requires
 * only `id` — so every node matched it and was serialized as one. A `RuleSetNode`
 * came back with no `ruleSetVersion` and a `PatchNode` with neither of its
 * halves. Nothing failed: the node simply arrived naming nothing to run, and a
 * client that saved what it read sent back a node the writer refuses. Found by
 * `test/web/queryGroupCanvasRoundTrip.test.ts`, where the canvas could not save
 * a rule set node it had just loaded.
 *
 * A `QueryNode` is the one kind that survived, because its properties are a
 * subset of the dynamic node's — which is why the suites, all built on query
 * nodes, were green throughout.
 *
 * This asserts the property directly rather than through a built graph: the
 * ordering is a rule about the schema, and a `PatchNode` cannot be built through
 * the phase 2 harness at all. Cheap enough to cover all four kinds, including
 * ones no fixture exercises yet.
 */

/** One node of each kind, carrying every property its own schema declares. */
const NODES = {
  RuleSetNode: {
    id: 'urn:sqlib:node:ruleset',
    nodeType: 'RuleSetNode',
    ruleSetVersion: 'urn:sqlib:rule-set-version:1',
    inputs: ['urn:sqlib:triples-quads-io:in'],
    outputs: ['urn:sqlib:triples-quads-io:out'],
  },
  PatchNode: {
    id: 'urn:sqlib:node:patch',
    nodeType: 'PatchNode',
    queryId: 'urn:sqlib:query-version:update',
    backendId: 'urn:sqlib:backend:store',
    inputs: [],
    outputs: ['urn:sqlib:triples-quads-io:del', 'urn:sqlib:triples-quads-io:add'],
    deletionsOutput: 'urn:sqlib:triples-quads-io:del',
    additionsOutput: 'urn:sqlib:triples-quads-io:add',
  },
  QueryNode: {
    id: 'urn:sqlib:node:query',
    nodeType: 'QueryNode',
    queryId: 'urn:sqlib:query-version:select',
    backendId: 'urn:sqlib:backend:store',
    inputs: ['urn:sqlib:input-tuple:params'],
    outputs: ['urn:sqlib:output-tuple:rows'],
  },
  DynamicQueryNode: {
    id: 'urn:sqlib:node:dynamic',
    nodeType: 'DynamicQueryNode',
    queryId: 'urn:sqlib:query-version:select',
    backendId: 'urn:sqlib:backend:store',
    inputs: ['urn:sqlib:query-id-input:which'],
    outputs: ['urn:sqlib:output-tuple:rows'],
  },
  /**
   * An ephemeral node, which is the other way a node names where it runs. It is
   * here because `backendConfig` is an object rather than a string, so a branch
   * that declared it differently would not merely drop it.
   */
  EphemeralQueryNode: {
    id: 'urn:sqlib:node:ephemeral',
    nodeType: 'QueryNode',
    queryId: 'urn:sqlib:query-version:select',
    backendConfig: { type: 'ephemeral-oxigraph', storeId: 'urn:sqlib:store:1' },
    inputs: [],
    outputs: ['urn:sqlib:output-tuple:rows'],
  },
} as const;

describe('execution nodes serialize as the kind they are', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // `serializerOpts` is what makes this a faithful reproduction rather than a
    // simpler app that happens to share a schema: without it fast-json-stringify
    // does not know the `iri` format the contracts emit, drops those fields from
    // its own branch-selection ajv, and stops discriminating at all (#311). A
    // serializer that cannot tell the branches apart keeps everything, so this
    // whole file would pass on the bug it exists to catch.
    app = Fastify({ serializerOpts });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    /*
     * The real response schema, on a handler that echoes what it is given: the
     * subject is the serializer, not the expander. Registered at the route's own
     * path because the schema validates `params` too, and a handler mounted
     * anywhere else answers 400 before it ever reaches the serializer.
     */
    app.get(
      '/query-groups/:id/v/:version',
      { schema: getQueryGroupVersionForGroupSchema },
      async (request) => JSON.parse(String((request.query as { node: string }).node)),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const serialize = async (node: Record<string, unknown>) => {
    const response = await app.inject({
      method: 'GET',
      url: '/query-groups/urn:sqlib:group:1/v/1',
      query: {
        node: JSON.stringify({
          // The envelope is not the subject; it just has to serialize.
          queryGroupVersion: { id: 'urn:sqlib:group-version:1', version: 1, isPartOf: 'urn:sqlib:group:1' },
          executionNodes: [node],
        }),
      },
    });
    expect(response.statusCode, response.payload.slice(0, 400)).toBe(200);
    return response.json().executionNodes[0] as Record<string, unknown>;
  };

  for (const [label, node] of Object.entries(NODES)) {
    it(`keeps every property of a ${label}`, async () => {
      const serialized = await serialize(node as unknown as Record<string, unknown>);
      for (const [key, value] of Object.entries(node)) {
        expect(serialized[key], `${label} lost "${key}" on the way out`).toEqual(value);
      }
    });
  }

  it('keeps a rule set node whole even when it does not say what it is', async () => {
    // `nodeType` is derived on the way out (`node.nodeType || node['@type']`),
    // so a node whose type was never stamped has only its own properties to be
    // recognised by. That is what the ordering is for: it is the `required`
    // lists that discriminate, and `ruleSetVersion` is asked for by exactly one
    // branch.
    const { nodeType: _nodeType, ...unlabelled } = NODES.RuleSetNode;
    const serialized = await serialize(unlabelled);
    expect(serialized.ruleSetVersion).toBe(NODES.RuleSetNode.ruleSetVersion);
  });
});
