import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import queryGroupRoutes from '../../src/routes/query-groups.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

/**
 * `GET /query-groups/:id/v/:version` computes an `iriMap` of query version IRI
 * to query name, and until #49 the 200 schema's `additionalProperties: false`
 * stripped it back off. The route did the work and fastify discarded it, so the
 * canvas had no source for query names and labelled every query node
 * "Query Node".
 *
 * These tests pin the two halves of that: the map survives serialization, and
 * the un-enriched fallback (which has no map) still serializes rather than
 * 500ing — which is why `iriMap` is optional here and required on create.
 */

const hoisted = vi.hoisted(() => ({
  coordinatorList: vi.fn(),
  coordinatorGet: vi.fn(),
  expandGroupVersion: vi.fn(),
  expandGroupVersionDetailed: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.coordinatorGet,
    list: hoisted.coordinatorList,
  }),
}));

vi.mock('../../src/lib/GraphResolver.js', () => ({
  expandGroupVersion: hoisted.expandGroupVersion,
  expandGroupVersionDetailed: hoisted.expandGroupVersionDetailed,
  expandCurrentVersionForGroup: vi.fn(),
}));

const GROUP_ID = 'urn:group:test';
const VERSION_ID = 'urn:version:1';
const QUERY_ID = 'urn:query:cities';
const QUERY_VERSION_ID = 'urn:queryversion:cities-1';
const RULE_SET_ID = 'urn:ruleset:transit';
const RULE_SET_VERSION_ID = 'urn:rulesetversion:transit-1';

// The cache holds `$id`; the expanders hand back the REST shape, whose
// `querygroupversion#` document requires `id`. Both keys are present so the one
// fixture can stand in on either side of that boundary.
const groupVersion = {
  $id: VERSION_ID,
  id: VERSION_ID,
  '@type': 'QueryGroupVersion',
  isPartOf: GROUP_ID,
  version: 1,
};

describe('GET /query-groups/:id/v/:version — iriMap (#49)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(queryGroupRoutes, { prefix: '/query-groups' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.coordinatorList.mockImplementation((type: string) => {
      if (type === 'QueryGroupVersion') return [groupVersion];
      if (type === 'Query') return [{ $id: QUERY_ID, '@type': 'Query', name: 'Cities' }];
      if (type === 'QueryVersion') {
        return [{ $id: QUERY_VERSION_ID, '@type': 'QueryVersion', isPartOf: QUERY_ID }];
      }
      if (type === 'RuleSet') return [{ $id: RULE_SET_ID, '@type': 'RuleSet', name: 'Transit Rules' }];
      if (type === 'RuleSetVersion') {
        return [{ $id: RULE_SET_VERSION_ID, '@type': 'RuleSetVersion', isPartOf: RULE_SET_ID }];
      }
      return [];
    });
    hoisted.expandGroupVersion.mockResolvedValue({ queryGroupVersion: groupVersion });
  });

  it('returns the iriMap instead of computing it and dropping it', async () => {
    hoisted.expandGroupVersionDetailed.mockResolvedValue({
      queryGroupVersion: groupVersion,
      executionNodes: [],
      edges: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/query-groups/${encodeURIComponent(GROUP_ID)}/v/1`,
    });

    expect(res.statusCode).toBe(200);
    // Keyed by query *version* IRI — that is what the canvas looks a node up by
    // (`graphNode.queryVersionId ?? graphNode.queryId`), and the values are
    // display names, not IRIs.
    expect(res.json().iriMap).toEqual({
      [QUERY_VERSION_ID]: 'Cities',
      // A RuleSetNode names a rule set *version*, and the canvas labels it from
      // this same map. Keyed by query version alone, an assigned rule set read
      // back as "Unknown" after every reload.
      [RULE_SET_VERSION_ID]: 'Transit Rules',
    });
  });

  it('still serializes the fallback payload, which carries no iriMap', async () => {
    hoisted.expandGroupVersionDetailed.mockRejectedValue(new Error('resolver unavailable'));

    const res = await app.inject({
      method: 'GET',
      url: `/query-groups/${encodeURIComponent(GROUP_ID)}/v/1`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('iriMap');
  });
});
