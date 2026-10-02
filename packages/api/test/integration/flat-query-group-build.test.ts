import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import queryGroupRoutes from '../../src/routes/query-groups.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) {
      app.addSchema(schema);
    }
  }
  await app.register(queryGroupRoutes, { prefix: '/query-groups' });
  await app.ready();
  return app;
}

describe('Flat Query Group Building Flow', () => {
  // The repositories are stubs that keep nothing, so a write-through update
  // would read back an entity the store never held, which the coordinator
  // refuses. These suites are about the cache and the routes, not storage.
  let writeThroughBefore: string | undefined;
  beforeAll(() => {
    writeThroughBefore = process.env.CACHE_WRITE_THROUGH;
    process.env.CACHE_WRITE_THROUGH = 'false';
  });
  afterAll(() => {
    if (writeThroughBefore === undefined) delete process.env.CACHE_WRITE_THROUGH;
    else process.env.CACHE_WRITE_THROUGH = writeThroughBefore;
  });

  let app: FastifyInstance;
  const testGroupId = 'urn:sqlib:group:test-group-flat';
  const existingQueryId = 'urn:sqlib:query:existing-query';
  // A node's queryId names a QueryVersion, not a Query (QueryNodeSchema.ts:50,
  // and it is the version the harness and the canvas both send). This fixture
  // used to point at the Query, which went unnoticed while nothing checked.
  const existingQueryVersionId = 'urn:sqlib:query-version:existing-query-v1';
  const testBackendId = 'urn:sqlib:backend:test-backend';

  let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

  beforeEach(async () => {
    // A query group, a query with one version, and a backend.
    store = await installFakePersistenceAdapter([
      { type: 'QueryGroup', entity: { $id: testGroupId, '@type': 'QueryGroup', name: 'Test Group Flat' } },
      { type: 'Query', entity: { $id: existingQueryId, '@type': 'Query', name: 'Existing Query' } },
      {
        type: 'QueryVersion',
        entity: { $id: existingQueryVersionId, '@type': 'QueryVersion', isPartOf: existingQueryId, version: 1 },
      },
      {
        type: 'Backend',
        entity: {
          $id: testBackendId,
          '@type': 'Backend',
          name: 'Test Backend',
          backendType: BackendTypeIri.http,
          endpoint: 'http://example.com/sparql',
        },
      },
    ]);

    app = await buildTestApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    store.restore();
  });

  it('should create a complex query group version from a single flat payload', async () => {
    const payload = {
      queryGroupVersion: { comment: 'Flat created version' },
      executionNodes: [
        { id: 'urn:ui-temp:node-1', queryId: existingQueryVersionId, backendId: testBackendId },
      ],
      outputs: [
        { id: 'urn:ui-temp:var-1', variableName: 'myVar' },
      ],
      tupleMembers: [
        { id: 'urn:ui-temp:member-1', position: 0, variable: 'urn:ui-temp:var-1' }
      ],
      outputTuples: [
        { id: 'urn:ui-temp:tuple-1', name: 'My Output Tuple', memberEntries: ['urn:ui-temp:member-1'] },
      ],
      edges: [
        { id: 'urn:ui-temp:edge-1', sourceNodeId: 'urn:__START__', targetNodeId: 'urn:ui-temp:node-1' },
        { id: 'urn:ui-temp:edge-2', sourceNodeId: 'urn:ui-temp:node-1', targetNodeId: 'urn:__END__', targetInputId: 'urn:ui-temp:tuple-1' },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: `/query-groups/${testGroupId}/v`,
      payload,
    });

    expect(response.statusCode, response.payload).toBe(201);
    const body = response.json();

    // Check iriMap
    expect(body.iriMap).toBeDefined();
    expect(body.iriMap['urn:ui-temp:node-1']).toBeDefined();
    expect(body.iriMap['urn:ui-temp:tuple-1']).toBeDefined();
    expect(body.iriMap['urn:ui-temp:var-1']).toBeDefined();
    expect(body.iriMap['urn:ui-temp:edge-1']).toBeDefined();
    expect(body.iriMap['urn:ui-temp:edge-2']).toBeDefined();
    expect(body.iriMap['urn:__START__']).toBeDefined();
    expect(body.iriMap['urn:__END__']).toBeDefined();

    // Check that the response contains the expected data
    expect(body.queryGroupVersion).toBeDefined();
    expect(body.executionNodes).toBeDefined();
    expect(body.executionNodes).toHaveLength(1);
    expect(body.edges).toBeDefined();
    expect(body.edges).toHaveLength(2);

    // Verify that permanent IRIs were created for all temporary IDs
    expect(body.iriMap['urn:ui-temp:node-1']).toMatch(/^urn:sqlib:node:/);
    expect(body.iriMap['urn:ui-temp:tuple-1']).toMatch(/^urn:sqlib:output-tuple:/);
    expect(body.iriMap['urn:ui-temp:var-1']).toMatch(/^urn:sqlib:output:/);
    expect(body.iriMap['urn:ui-temp:edge-1']).toMatch(/^urn:sqlib:edge:/);
    expect(body.iriMap['urn:ui-temp:edge-2']).toMatch(/^urn:sqlib:edge:/);
    expect(body.iriMap['urn:__START__']).toMatch(/^urn:sqlib:start-node:/);
    expect(body.iriMap['urn:__END__']).toMatch(/^urn:sqlib:end-node:/);

    // And the version, with the nodes and edges it names, is what was stored.
    const [stored] = store.all('QueryGroupVersion');
    expect(stored).toMatchObject({ isPartOf: testGroupId });
    expect(store.get(body.iriMap['urn:ui-temp:node-1'])).toMatchObject({
      queryId: existingQueryVersionId,
      backendId: testBackendId,
    });
    expect(store.get(body.iriMap['urn:ui-temp:edge-1'])).toMatchObject({
      sourceNodeId: body.iriMap['urn:__START__'],
      targetNodeId: body.iriMap['urn:ui-temp:node-1'],
    });
  });
});
