import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import dataGraphRoutes from '../../src/routes/data-graphs.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  dataGraph: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  dataGraphVersion: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  coordinatorGet: vi.fn(),
  mockCreateVersion: vi.fn(),
  mockUpdateVersion: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    DataGraph: hoisted.dataGraph,
    DataGraphVersion: hoisted.dataGraphVersion,
  }),
  getCacheCoordinator: () => ({
    get: hoisted.coordinatorGet,
  }),
}));

vi.mock('../../src/lib/DataGraphVersionWriter.js', () => ({
  createDataGraphVersion: hoisted.mockCreateVersion,
  annotateDataGraphVersion: hoisted.mockUpdateVersion,
}));

const LIBRARY_ID = 'urn:sqlib:library:lib1';
const GRAPH_ID = 'urn:sqlib:data-graph:g1';

describe('DataGraphs Routes (/data-graphs)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);

    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
      if (error.validation && Array.isArray(error.validation)) {
        return reply.status(statusCode).send({ error: error.validation[0]?.message ?? 'Validation failed' });
      }
      reply.status(statusCode).send({ error: error.message || 'An unexpected error occurred' });
    });

    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(dataGraphRoutes, { prefix: '/data-graphs' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.coordinatorGet.mockImplementation((iri: string) =>
      iri === LIBRARY_ID ? { $id: LIBRARY_ID, '@type': 'Library', name: 'Lib' } : null,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a data graph in a library', async () => {
    hoisted.dataGraph.create.mockImplementation(async (entity: Record<string, unknown>) => entity);

    const res = await app.inject({
      method: 'POST',
      url: '/data-graphs',
      payload: { name: 'Example data', isPartOf: [LIBRARY_ID] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Example data', isPartOf: [LIBRARY_ID] });
    expect(res.json().id).toMatch(/^urn:sqlib:data-graph:/);
  });

  it('rejects a data graph that names no library', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/data-graphs',
      payload: { name: 'Orphan', isPartOf: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects a data graph whose parent is not a library', async () => {
    hoisted.coordinatorGet.mockImplementation((iri: string) =>
      iri === 'urn:sqlib:query:q1' ? { $id: 'urn:sqlib:query:q1', '@type': 'Query', name: 'Q' } : null,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/data-graphs',
      payload: { name: 'Wrong parent', isPartOf: ['urn:sqlib:query:q1'] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('creates a version through the writer and returns its computed facts', async () => {
    hoisted.dataGraph.get.mockReturnValue({ $id: GRAPH_ID, '@type': 'DataGraph', name: 'Example data' });
    hoisted.mockCreateVersion.mockResolvedValue({
      $id: 'urn:sqlib:data-graph-version:v1',
      '@type': 'DataGraphVersion',
      isPartOf: GRAPH_ID,
      version: 1,
      contentString: '@prefix : <http://ex/> . :a :edge :b .',
      contentFormat: 'text/turtle',
      tripleCount: 1,
      byteSize: 38,
      grammarValid: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions`,
      payload: {
        contentString: '@prefix : <http://ex/> . :a :edge :b .',
        contentFormat: 'text/turtle',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ version: 1, tripleCount: 1, contentFormat: 'text/turtle' });
  });

  it('turns a writer rejection into a 400 rather than a 500', async () => {
    hoisted.dataGraph.get.mockReturnValue({ $id: GRAPH_ID, '@type': 'DataGraph', name: 'Example data' });
    hoisted.mockCreateVersion.mockRejectedValue(new Error('Invalid text/turtle content: bad syntax'));

    const res = await app.inject({
      method: 'POST',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions`,
      payload: { contentString: 'not turtle {{{', contentFormat: 'text/turtle' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid text\/turtle content/);
  });

  it('rejects a format the executor could not load', async () => {
    hoisted.dataGraph.get.mockReturnValue({ $id: GRAPH_ID, '@type': 'DataGraph', name: 'Example data' });

    const res = await app.inject({
      method: 'POST',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions`,
      payload: { contentString: '<a/>', contentFormat: 'application/rdf+xml' },
    });

    expect(res.statusCode).toBe(400);
    expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
  });

  it('refuses to edit a version, and annotates one instead', async () => {
    // A version is a snapshot (issue #192): the content is what a rule set run
    // against this graph was run against. The comment about it stays writable.
    hoisted.dataGraph.get.mockReturnValue({ $id: GRAPH_ID, '@type': 'DataGraph', name: 'Example data' });
    hoisted.dataGraphVersion.list.mockReturnValue([
      {
        $id: 'urn:sqlib:data-graph-version:v1',
        isPartOf: GRAPH_ID,
        version: 1,
        immutable: true,
        contentString: '',
        contentFormat: 'text/turtle',
      },
    ]);

    const refused = await app.inject({
      method: 'PATCH',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/1`,
      payload: { contentString: '<urn:s> <urn:p> <urn:o> .' },
    });

    expect(refused.statusCode).toBe(409);
    expect(refused.json().fields).toEqual(['contentString']);
    expect(hoisted.mockUpdateVersion).not.toHaveBeenCalled();

    hoisted.mockUpdateVersion.mockResolvedValue({
      $id: 'urn:sqlib:data-graph-version:v1',
      '@type': 'DataGraphVersion',
      isPartOf: GRAPH_ID,
      version: 1,
      immutable: true,
      contentString: '',
      contentFormat: 'text/turtle',
      comment: 'tweak',
    });

    const annotated = await app.inject({
      method: 'PATCH',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}/versions/1`,
      payload: { comment: 'tweak' },
    });

    expect(annotated.statusCode, annotated.payload).toBe(200);
    expect(hoisted.mockUpdateVersion).toHaveBeenCalledWith('urn:sqlib:data-graph-version:v1', {
      comment: 'tweak',
      immutable: undefined,
    });
  });

  it('cascades version deletes when the data graph goes', async () => {
    hoisted.dataGraph.get.mockReturnValue({ $id: GRAPH_ID, '@type': 'DataGraph', name: 'Example data' });
    hoisted.dataGraphVersion.list.mockReturnValue([
      { $id: 'urn:sqlib:data-graph-version:v1', isPartOf: GRAPH_ID, version: 1 },
      { $id: 'urn:sqlib:data-graph-version:v2', isPartOf: GRAPH_ID, version: 2 },
      { $id: 'urn:sqlib:data-graph-version:other', isPartOf: 'urn:sqlib:data-graph:other', version: 1 },
    ]);

    const res = await app.inject({
      method: 'DELETE',
      url: `/data-graphs/${encodeURIComponent(GRAPH_ID)}`,
    });

    expect(res.statusCode).toBe(204);
    expect(hoisted.dataGraphVersion.delete).toHaveBeenCalledTimes(2);
    expect(hoisted.dataGraph.delete).toHaveBeenCalledWith(GRAPH_ID);
  });
});
