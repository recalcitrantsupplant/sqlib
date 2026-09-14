import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, MockInstance } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const hoisted = vi.hoisted(() => ({
  mintId: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  createGroupVersionFlat: vi.fn(),
  expandGroupVersion: vi.fn(),
  expandGroupVersionDetailed: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    list: hoisted.list,
    get: hoisted.get,
    create: hoisted.create,
    update: hoisted.update,
    delete: hoisted.remove,
  }),
}));

describe('Query group routes', () => {
  let app: FastifyInstance;
  let queryGroupRoutes: any;
  let mintSpy: MockInstance<(kind: string, suffix?: string | undefined) => string>;
  let writerSpy: MockInstance<(groupId: string, body: any) => Promise<any>>;
  let expandSpy: MockInstance<(version: any) => Promise<any>>;
  let expandDetailedSpy: MockInstance<(version: any) => Promise<any>>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(() => {
      const validate = () => true;
      (validate as any).errors = [];
      return validate;
    });
    app.log.error = vi.fn();
    const schemas = await import('@sparql-query-lib/contracts/schema');
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema as any);
      }
    }
    queryGroupRoutes = (await import('../../src/routes/query-groups.js')).default;
    const idModule = await import('../../src/lib/id.js');
    mintSpy = vi.spyOn(idModule, 'mintId').mockImplementation(hoisted.mintId);
    const writerModule = await import('../../src/lib/GroupVersionWriter.js');
    writerSpy = vi.spyOn(writerModule, 'createGroupVersionFlat').mockImplementation(hoisted.createGroupVersionFlat);
    const graphModule = await import('../../src/lib/GraphResolver.js');
    expandSpy = vi.spyOn(graphModule, 'expandGroupVersion').mockImplementation(hoisted.expandGroupVersion);
    expandDetailedSpy = vi.spyOn(graphModule, 'expandGroupVersionDetailed').mockImplementation(hoisted.expandGroupVersionDetailed);
    await app.register(queryGroupRoutes, { prefix: '/query-groups' });
    await app.ready();
  });

  afterAll(async () => {
    mintSpy.mockRestore();
    writerSpy.mockRestore();
    expandSpy.mockRestore();
    expandDetailedSpy.mockRestore();
    await app.close();
  });

  beforeEach(() => {
    hoisted.mintId.mockReset();
    hoisted.list.mockReset();
    hoisted.get.mockReset();
    hoisted.create.mockReset();
    hoisted.update.mockReset();
    hoisted.remove.mockReset();
    hoisted.createGroupVersionFlat.mockReset();
    hoisted.expandGroupVersion.mockReset();
    hoisted.expandGroupVersionDetailed.mockReset();
    hoisted.list.mockReturnValue([]);
    hoisted.get.mockReturnValue(undefined);
    hoisted.create.mockResolvedValue(undefined);
    hoisted.update.mockResolvedValue(undefined);
    hoisted.remove.mockResolvedValue(undefined);
    hoisted.createGroupVersionFlat.mockResolvedValue({ created: {}, iriMap: {} });
    hoisted.expandGroupVersion.mockResolvedValue({ queryGroupVersion: { isPartOf: 'urn:lib:default' }, executionNodes: [], edges: [] });
    hoisted.expandGroupVersionDetailed.mockResolvedValue({ queryGroupVersion: { isPartOf: 'urn:lib:default' }, executionNodes: [], edges: [] });
  });

  it('GET /query-groups returns cached groups', async () => {
    hoisted.list.mockImplementation((type: string) => {
      if (type === 'QueryGroup') {
        return [
          { $id: 'urn:group:1', name: 'Group A', '@type': 'QueryGroup', isPartOf: 'urn:lib:1' },
          { $id: 'urn:group:2', name: 'Group B', '@type': 'QueryGroup', isPartOf: 'urn:lib:1' },
        ];
      }
      return [];
    });

    const res = await app.inject({ method: 'GET', url: '/query-groups' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 'urn:group:1', name: 'Group A', isPartOf: 'urn:lib:1' },
      { id: 'urn:group:2', name: 'Group B', isPartOf: 'urn:lib:1' },
    ]);
  });

  it('POST /query-groups creates a group when library is valid', async () => {
    hoisted.mintId.mockReturnValue('urn:group:new');
    hoisted.get.mockReturnValue({ $id: 'urn:lib:1', '@type': 'Library', name: 'Lib' });
    hoisted.create.mockResolvedValue({
      $id: 'urn:group:new',
      name: 'Example',
      '@type': 'QueryGroup',
      isPartOf: 'urn:lib:1',
      dateModified: '2024-03-01T10:00:00.000Z',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/query-groups',
      payload: {
        name: 'Example',
        isPartOf: 'urn:lib:1',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(hoisted.create).toHaveBeenCalledWith('QueryGroup', {
      $id: 'urn:group:new',
      name: 'Example',
      description: undefined,
      comment: undefined,
      isPartOf: 'urn:lib:1',
    });
    expect(res.json()).toMatchObject({ id: 'urn:group:new', name: 'Example', isPartOf: 'urn:lib:1' });
    expect(res.headers.etag).toBe('"2024-03-01T10:00:00.000Z"');
    expect(res.headers['last-modified']).toBe(new Date('2024-03-01T10:00:00.000Z').toUTCString());
  });

  it('POST /query-groups rejects missing library references', async () => {
    hoisted.get.mockReturnValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/query-groups',
      payload: {
        name: 'Example',
        isPartOf: 'urn:lib:missing',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Referenced library does not exist');
  });

  it('POST /query-groups enforces library type', async () => {
    hoisted.get.mockReturnValue({ $id: 'urn:not:lib', '@type': 'QueryGroup' });

    const res = await app.inject({
      method: 'POST',
      url: '/query-groups',
      payload: {
        name: 'Example',
        isPartOf: 'urn:not:lib',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Query groups can only belong to libraries');
  });

  it('GET /query-groups/:id returns a group when present', async () => {
    hoisted.get.mockReturnValue({
      $id: 'urn:group:1',
      '@type': 'QueryGroup',
      name: 'Group',
      isPartOf: 'urn:lib:1',
      dateModified: '2024-04-01T12:00:00.000Z',
    });

    const res = await app.inject({ method: 'GET', url: `/query-groups/${encodeURIComponent('urn:group:1')}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'urn:group:1', name: 'Group', isPartOf: 'urn:lib:1' });
    expect(res.headers.etag).toBe('"2024-04-01T12:00:00.000Z"');
    expect(res.headers['last-modified']).toBe(new Date('2024-04-01T12:00:00.000Z').toUTCString());
  });

  it('GET /query-groups/:id returns 404 when missing', async () => {
    hoisted.get.mockReturnValue(null);

    const res = await app.inject({ method: 'GET', url: `/query-groups/${encodeURIComponent('urn:missing')}` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Not Found');
  });

  it('PUT /query-groups/:id validates updated library', async () => {
    hoisted.get
      .mockReturnValueOnce({ $id: 'urn:group:1', '@type': 'QueryGroup', isPartOf: 'urn:lib:1', dateModified: '2024-01-01T00:00:00.000Z' })
      .mockReturnValueOnce({ $id: 'urn:lib:missing', '@type': 'SomethingElse' });

    const res = await app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}`,
      payload: {
        isPartOf: 'urn:lib:missing',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Query groups can only belong to libraries');
  });

  it('PUT /query-groups/:id updates group', async () => {
    hoisted.get
      .mockReturnValueOnce({ $id: 'urn:group:1', '@type': 'QueryGroup', isPartOf: 'urn:lib:1', dateModified: '2024-01-01T00:00:00.000Z' })
      .mockReturnValueOnce({ $id: 'urn:lib:1', '@type': 'Library' });
    hoisted.update.mockResolvedValue({ $id: 'urn:group:1', '@type': 'QueryGroup', name: 'Updated', isPartOf: 'urn:lib:1', dateModified: '2024-01-02T00:00:00.000Z' });

    const res = await app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}`,
      payload: {
        name: 'Updated',
        isPartOf: 'urn:lib:1',
      },
      headers: { 'if-match': '2024-01-01T00:00:00.000Z' },
    });

    expect(res.statusCode).toBe(200);
    expect(hoisted.update).toHaveBeenCalledWith('QueryGroup', 'urn:group:1', { name: 'Updated', isPartOf: 'urn:lib:1' });
    expect(res.json()).toMatchObject({ id: 'urn:group:1', name: 'Updated', isPartOf: 'urn:lib:1' });
    expect(res.headers.etag).toBe('"2024-01-02T00:00:00.000Z"');
    expect(res.headers['last-modified']).toBe(new Date('2024-01-02T00:00:00.000Z').toUTCString());
  });

  it('PUT /query-groups/:id returns 412 on stale If-Match', async () => {
    hoisted.get.mockReturnValue({ $id: 'urn:group:1', '@type': 'QueryGroup', isPartOf: 'urn:lib:1', dateModified: '2024-01-01T00:00:00.000Z' });

    const res = await app.inject({
      method: 'PUT',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}`,
      payload: { name: 'Updated' },
      headers: { 'if-match': 'mismatch' },
    });

    expect(res.statusCode).toBe(412);
    expect(hoisted.update).not.toHaveBeenCalled();
  });

  it('DELETE /query-groups/:id removes group', async () => {
    hoisted.remove.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'DELETE',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}`,
    });

    expect(res.statusCode).toBe(204);
    expect(hoisted.remove).toHaveBeenCalledWith('QueryGroup', 'urn:group:1');
  });

  it('GET .../validate reports the structural code and entity from the error itself', async () => {
    // The offending entity used to be regex-scraped out of the message prose, so a
    // reworded message silently moved the canvas highlight. It now comes from the
    // typed error, and the code identifies the specific rule rather than a catch-all.
    const version = {
      $id: 'urn:qgv:validate', '@type': 'QueryGroupVersion', isPartOf: 'urn:group:1', version: 1,
      executionNodes: ['urn:node:v1', 'urn:node:v-end'], edges: ['urn:edge:bad'],
    };
    const entities = new Map<string, any>([
      ['urn:backend:v', { $id: 'urn:backend:v', '@type': 'Backend' }],
      ['urn:qv:v', { $id: 'urn:qv:v', '@type': 'QueryVersion', queryString: 'SELECT ?x WHERE { ?x ?p ?o }', queryType: 'https://sparql-query-lib/query-type/select' }],
      ['urn:out:v', { $id: 'urn:out:v', '@type': 'QueryOutput', variableName: 'x' }],
      ['urn:tm:v', { $id: 'urn:tm:v', '@type': 'TupleMember', position: 0, variable: 'urn:out:v' }],
      ['urn:tuple:v', { $id: 'urn:tuple:v', '@type': 'QueryOutputTuple', memberEntries: ['urn:tm:v'] }],
      ['urn:node:v1', { $id: 'urn:node:v1', '@type': 'QueryNode', backendId: 'urn:backend:v', queryId: 'urn:qv:v', outputs: ['urn:tuple:v'] }],
      ['urn:node:v-end', { $id: 'urn:node:v-end', '@type': 'EndNode', inputs: ['urn:tuple:v'] }],
      // A CONTROL_FLOW edge may not carry I/O references.
      ['urn:edge:bad', {
        $id: 'urn:edge:bad', '@type': 'QueryEdge',
        sourceNodeId: 'urn:node:v1', targetNodeId: 'urn:node:v-end',
        dataFlowType: 'CONTROL_FLOW', sourceOutputId: 'urn:tuple:v', targetInputId: 'urn:tuple:v',
      }],
      ['urn:qgv:validate', version],
    ]);
    hoisted.list.mockImplementation((type: string) => type === 'QueryGroupVersion' ? [version] : []);
    hoisted.get.mockImplementation((id: string) => entities.get(id) ?? null);

    const res = await app.inject({
      method: 'GET',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}/v/1/validate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.issues).toContainEqual(expect.objectContaining({
      level: 'error',
      code: 'EDGE_CONTROL_FLOW_HAS_IO',
      entityType: 'edge',
      entityId: 'urn:edge:bad',
    }));
    expect(body.issues.some((issue: { code: string }) => issue.code === 'GRAPH_VALIDATION')).toBe(false);
  });

  it('DELETE /query-groups/:id cascades through version-owned graph entities', async () => {
    hoisted.list.mockImplementation((type: string) => type === 'QueryGroupVersion' ? [{
      $id: 'urn:qgv:1', '@type': 'QueryGroupVersion', isPartOf: 'urn:group:1',
      executionNodes: ['urn:node:1'], edges: ['urn:edge:1'],
    }] : []);
    const entities = new Map<string, any>([
      ['urn:node:1', { $id: 'urn:node:1', '@type': 'QueryNode', outputs: ['urn:tuple:1'] }],
      ['urn:tuple:1', { $id: 'urn:tuple:1', '@type': 'QueryOutputTuple', memberEntries: ['urn:member:1'] }],
      ['urn:member:1', { $id: 'urn:member:1', '@type': 'TupleMember', variable: 'urn:variable:1' }],
      ['urn:variable:1', { $id: 'urn:variable:1', '@type': 'QueryOutputVariable' }],
      ['urn:edge:1', { $id: 'urn:edge:1', '@type': 'QueryEdge' }],
    ]);
    hoisted.get.mockImplementation((id: string) => entities.get(id));

    const res = await app.inject({
      method: 'DELETE',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}`,
    });

    expect(res.statusCode).toBe(204);
    for (const [id, entity] of entities) {
      expect(hoisted.remove).toHaveBeenCalledWith(entity['@type'], id);
    }
    expect(hoisted.remove).toHaveBeenCalledWith('QueryGroupVersion', 'urn:qgv:1');
    expect(hoisted.remove).toHaveBeenLastCalledWith('QueryGroup', 'urn:group:1');
  });

  it('GET /query-groups/:id/v returns sorted versions', async () => {
    hoisted.list.mockImplementation((type: string) => {
      if (type === 'QueryGroupVersion') {
        return [
          { $id: 'urn:qgv:2', version: '2', '@type': 'QueryGroupVersion', isPartOf: 'urn:group:1' },
          { $id: 'urn:qgv:1', version: '1', '@type': 'QueryGroupVersion', isPartOf: 'urn:group:1' },
          { $id: 'urn:qgv:3', version: '1', '@type': 'QueryGroupVersion', isPartOf: 'urn:group:2' },
        ];
      }
      return [];
    });

    const res = await app.inject({
      method: 'GET',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}/v`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 'urn:qgv:1', isPartOf: 'urn:group:1', version: 1 },
      { id: 'urn:qgv:2', isPartOf: 'urn:group:1', version: 2 },
    ]);
  });

  it('POST /query-groups/:id/v validates wrapper payload', async () => {
    hoisted.get.mockReturnValue({ $id: 'urn:group:1', '@type': 'QueryGroup' });

    const res = await app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}/v`,
      payload: {
        canvasData: {},
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Body must contain queryGroupVersion object');
  });

  it('POST /query-groups/:id/v returns 404 when parent group is missing', async () => {
    hoisted.get.mockReturnValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent('urn:group:missing')}/v`,
      payload: {
        queryGroupVersion: {},
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('QueryGroup not found');
    expect(hoisted.createGroupVersionFlat).not.toHaveBeenCalled();
  });

  it('POST /query-groups/:id/v creates version and returns expanded payload', async () => {
    hoisted.get.mockReturnValue({ $id: 'urn:group:1', '@type': 'QueryGroup' });
    hoisted.createGroupVersionFlat.mockResolvedValue({
      created: {
        $id: 'urn:qgv:1',
        '@type': 'QueryGroupVersion',
        groupId: 'urn:group:1',
        version: 1,
        executionNodes: [],
        edges: [],
        isPartOf: 'urn:group:1',
        dateModified: '2024-06-01T08:00:00.000Z',
      },
      iriMap: { foo: 'bar' },
    });
    hoisted.expandGroupVersionDetailed.mockResolvedValue({
      queryGroupVersion: { id: 'urn:qgv:1', version: 1, isPartOf: 'urn:group:1' },
      executionNodes: [],
      edges: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}/v`,
      payload: {
        queryGroupVersion: {},
        executionNodes: ['urn:node:1'],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(hoisted.createGroupVersionFlat).toHaveBeenCalledWith('urn:group:1', { executionNodes: ['urn:node:1'] });
    const creationBody = res.json();
    if (!('iriMap' in creationBody)) {
      // eslint-disable-next-line no-console
      console.error('POST /query-groups/:id/v response body', creationBody);
    }
    expect(creationBody).toMatchObject({
      queryGroupVersion: { id: 'urn:qgv:1', version: 1, isPartOf: 'urn:group:1' },
      inputTuples: [],
      executionNodes: [],
      edges: [],
      iriMap: { foo: 'bar' },
    });
    expect(res.headers.etag).toBe('"2024-06-01T08:00:00.000Z"');
    expect(res.headers['last-modified']).toBe(new Date('2024-06-01T08:00:00.000Z').toUTCString());
  });

  it('POST /query-groups/:id/v accepts rule-set-only execution graphs', async () => {
    hoisted.get.mockReturnValue({ $id: 'urn:group:ruleset', '@type': 'QueryGroup' });
    hoisted.createGroupVersionFlat.mockResolvedValue({
      created: {
        $id: 'urn:qgv:ruleset',
        '@type': 'QueryGroupVersion',
        groupId: 'urn:group:ruleset',
        version: 1,
        executionNodes: ['urn:node:ruleset'],
        edges: [],
        isPartOf: 'urn:group:ruleset',
        dateModified: '2024-06-01T08:00:00.000Z',
      },
      iriMap: { 'urn:ui-temp:node-ruleset': 'urn:node:ruleset' },
    });
    hoisted.expandGroupVersionDetailed.mockResolvedValue({
      queryGroupVersion: { id: 'urn:qgv:ruleset', version: 1, isPartOf: 'urn:group:ruleset' },
      executionNodes: [],
      edges: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent('urn:group:ruleset')}/v`,
      payload: {
        queryGroupVersion: {},
        executionNodes: [
          {
            id: 'urn:ui-temp:node-ruleset',
            nodeType: 'RuleSetNode',
            ruleSetVersion: 'urn:ruleset:version:1',
            inputs: ['urn:ui-temp:rdf-input'],
            outputs: ['urn:ui-temp:rdf-output'],
          },
        ],
        rdfOutputs: [
          { id: 'urn:ui-temp:rdf-input', name: 'seed', ioType: 'input' },
          { id: 'urn:ui-temp:rdf-output', name: 'result', ioType: 'output' },
        ],
        edges: [],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(hoisted.createGroupVersionFlat).toHaveBeenCalledWith('urn:group:ruleset', expect.any(Object));
    expect(res.json()).toMatchObject({
      queryGroupVersion: { id: 'urn:qgv:ruleset', version: 1, isPartOf: 'urn:group:ruleset' },
    });
  });

  it('POST /query-groups/:id/v surfaces writer failures', async () => {
    hoisted.get.mockReturnValue({ $id: 'urn:group:1', '@type': 'QueryGroup' });
    hoisted.createGroupVersionFlat.mockRejectedValue(new Error('writer boom'));

    const res = await app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}/v`,
      payload: {
        queryGroupVersion: {},
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('writer boom');
  });

  it('POST /query-groups/:id/v preserves error envelope when expansion fails', async () => {
    hoisted.get.mockReturnValue({ $id: 'urn:group:1', '@type': 'QueryGroup' });
    hoisted.createGroupVersionFlat.mockResolvedValue({
      created: { $id: 'urn:qgv:1', groupId: 'urn:group:1', version: 1, '@type': 'QueryGroupVersion' },
      iriMap: {},
    });
    hoisted.expandGroupVersionDetailed.mockRejectedValue(new Error('expansion failed'));

    const res = await app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}/v`,
      payload: {
        queryGroupVersion: {},
      },
    });

    expect(hoisted.createGroupVersionFlat).toHaveBeenCalledWith('urn:group:1', {});
    expect(hoisted.expandGroupVersionDetailed).toHaveBeenCalledWith({
      $id: 'urn:qgv:1',
      groupId: 'urn:group:1',
      version: 1,
      '@type': 'QueryGroupVersion',
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Failed to create query group version' });
  });

  it('GET /query-groups/:id/v/:version returns expanded version', async () => {
    hoisted.list.mockImplementation((type: string) => {
      if (type === 'QueryGroupVersion') {
        return [
          {
            $id: 'urn:qgv:1',
            groupId: 'urn:group:1',
            version: 1,
            executionNodes: [],
            edges: [],
            isPartOf: 'urn:group:1',
            dateModified: '2024-06-15T11:00:00.000Z',
          },
        ];
      }
      return [];
    });
    hoisted.expandGroupVersionDetailed.mockResolvedValue({
      queryGroupVersion: { id: 'urn:qgv:1', version: 1, isPartOf: 'urn:group:1' },
      executionNodes: [],
      edges: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}/v/1`,
    });

    expect(res.statusCode).toBe(200);
    expect(hoisted.expandGroupVersion).toHaveBeenCalled();
    expect(res.json()).toEqual({
      queryGroupVersion: { id: 'urn:qgv:1', version: 1, isPartOf: 'urn:group:1' },
      executionNodes: [],
      edges: [],
      // Empty rather than absent: this fixture's cache holds no queries, so the
      // route builds an empty map. It reaches the client at all only since #49
      // added `iriMap` to the response schema — before that
      // `additionalProperties: false` stripped it. Populated-map coverage is in
      // query-group-version-get-irimap.test.ts.
      iriMap: {},
    });
    expect(res.headers.etag).toBe('"2024-06-15T11:00:00.000Z"');
    expect(res.headers['last-modified']).toBe(new Date('2024-06-15T11:00:00.000Z').toUTCString());
  });

  it('GET /query-groups/:id/v/:version returns 404 for missing version', async () => {
    hoisted.list.mockReturnValue([]);

    const res = await app.inject({
      method: 'GET',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}/v/2`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Not Found');
  });

  it('PATCH /query-groups/:id/v/:version enforces If-Match', async () => {
    hoisted.list.mockImplementation((type: string) => {
      if (type === 'QueryGroupVersion') {
        return [{
          $id: 'urn:qgv:1',
          '@type': 'QueryGroupVersion',
          groupId: 'urn:group:1',
          isPartOf: 'urn:group:1',
          version: 1,
          dateModified: '2024-01-01T00:00:00.000Z'
        }];
      }
      return [];
    });
    hoisted.update.mockResolvedValue({
      $id: 'urn:qgv:1',
      '@type': 'QueryGroupVersion',
      groupId: 'urn:group:1',
      isPartOf: 'urn:group:1',
      version: 1,
      comment: 'updated',
      dateModified: '2024-01-02T00:00:00.000Z'
    });
    hoisted.expandGroupVersionDetailed.mockResolvedValue({
      queryGroupVersion: { id: 'urn:qgv:1', version: 1, isPartOf: 'urn:group:1' },
      executionNodes: [],
      edges: []
    });

    const originalEnv = process.env.NODE_ENV;
    const originalVitestFlag = process.env.VITEST;
    process.env.NODE_ENV = 'development';
    process.env.VITEST = '1';

    const res = await app.inject({
      method: 'PATCH',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}/v/1`,
      payload: { comment: 'updated' },
      headers: { 'if-match': '2024-01-01T00:00:00.000Z' },
    });
    const body = res.json();
    if (res.statusCode !== 200) {
      // eslint-disable-next-line no-console
      console.error('PATCH /query-groups/:id/v/:version response', body);
      // eslint-disable-next-line no-console
      console.error('fastify error logs', (app.log.error as any)?.mock?.calls ?? []);
    }

    process.env.NODE_ENV = originalEnv;
    if (originalVitestFlag === undefined) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = originalVitestFlag;
    }

    expect(res.statusCode).toBe(200);
    expect(hoisted.update).toHaveBeenCalledWith('QueryGroupVersion', 'urn:qgv:1', { comment: 'updated' });

    hoisted.update.mockClear();

    const staleRes = await app.inject({
      method: 'PATCH',
      url: `/query-groups/${encodeURIComponent('urn:group:1')}/v/1`,
      payload: { comment: 'updated' },
      headers: { 'if-match': 'mismatch' },
    });

    expect(staleRes.statusCode).toBe(412);
    expect(hoisted.update).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  vi.resetModules();
});
