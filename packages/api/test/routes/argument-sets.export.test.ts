/**
 * What `/argument-sets/:id/export` actually puts on the wire.
 *
 * These go through `app.inject` on purpose. The defect they guard shipped
 * because every existing test called the service in-process, where the values
 * are always intact: the response schema declared
 * `items: { type: 'object' }` with no properties, and fast-json-stringify
 * emptied every element on the way out. The array came back the right length
 * and completely empty, so the tests screen showed `{"arguments":[{},{}]}` and
 * "Copy execution payload" handed out a silently unparameterised payload.
 *
 * The second group covers which version an export reads. A set means "whatever
 * it says now"; a version means "this, frozen" — and a caller that pinned one
 * had nowhere to send it, since the version route is keyed by set id plus
 * version *number* rather than by the version IRI a test case holds.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const store = new Map<string, Record<string, unknown>>();

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({}),
  getCacheCoordinator: () => ({
    get: (iri: string) => store.get(iri) ?? null,
    list: (type: string) => [...store.values()].filter(entity => entity['@type'] === type),
    create: async () => null,
    update: async () => null,
    delete: async () => {},
  }),
}));

vi.mock('../../src/auth/enforce.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../src/auth/enforce.js');
  return { ...actual, resolveOwningLibrary: () => 'urn:sqlib:library:lib1', requireLibraryMode: () => {} };
});

const SET_ID = 'urn:sqlib:argument-set:set1';
const V1 = 'urn:sqlib:argument-set-version:v1';
const V2 = 'urn:sqlib:argument-set-version:v2';
const BINDING_V1 = 'urn:sqlib:argument-tuple-binding:b1';
const BINDING_V2 = 'urn:sqlib:argument-tuple-binding:b2';
const LIMIT_ID = 'urn:sqlib:argument-scalar-binding:s1';

/** One tuple binding, stored the way the writer stores one: SRJ in a string. */
function tupleBinding(id: string, variable: string, value: string) {
  return {
    $id: id,
    '@type': 'ArgumentTupleBinding',
    tupleSignature: variable,
    fallbackVariables: [variable],
    contentString: JSON.stringify({
      head: { vars: [variable] },
      results: { bindings: [{ [variable]: { type: 'literal', value } }] },
    }),
  };
}

function seed() {
  store.clear();
  store.set(SET_ID, {
    $id: SET_ID,
    '@type': 'ArgumentSet',
    name: 'facets',
    argumentScope: 'query',
    targetEntity: 'urn:sqlib:query:q1',
    // v2 is current; v1 is the one an older test case would still pin.
    currentVersion: V2,
  });
  store.set(BINDING_V1, tupleBinding(BINDING_V1, 'term', 'shacl'));
  store.set(BINDING_V2, tupleBinding(BINDING_V2, 'term', 'rdf-star'));
  store.set(LIMIT_ID, {
    $id: LIMIT_ID,
    '@type': 'ArgumentScalarBinding',
    parameterKind: 'limit',
    parameterName: 'pageSize',
    numericValue: 20,
  });
  store.set(V1, {
    $id: V1,
    '@type': 'ArgumentSetVersion',
    isPartOf: SET_ID,
    version: 1,
    tupleBindings: [BINDING_V1],
    scalarBindings: [],
  });
  store.set(V2, {
    $id: V2,
    '@type': 'ArgumentSetVersion',
    isPartOf: SET_ID,
    version: 2,
    tupleBindings: [BINDING_V2],
    scalarBindings: [LIMIT_ID],
  });
}

describe('GET /argument-sets/:id/export', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const argumentSetRoutes = (await import('../../src/routes/argument-sets.js')).default;
    app = Fastify({ logger: false });
    setupValidator(app);
    app.setErrorHandler((error, _request, reply) => {
      reply.status(error.statusCode || 500).send({ error: error.message });
    });
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(argumentSetRoutes, { prefix: '/argument-sets' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    seed();
  });

  const exportOf = (id: string) =>
    app.inject({ method: 'GET', url: `/argument-sets/${encodeURIComponent(id)}/export` });

  it('serialises the argument rows rather than emptying them', async () => {
    const res = await exportOf(SET_ID);

    expect(res.statusCode).toBe(200);
    // Parsed from the body, not from the handler's return value: the serialiser
    // is the thing under test.
    const payload = JSON.parse(res.body);
    expect(payload.arguments).toHaveLength(1);
    expect(payload.arguments[0]).toEqual({
      head: { vars: ['term'] },
      arguments: { bindings: [{ term: { type: 'literal', value: 'rdf-star' } }] },
    });
  });

  it('serialises limits and offsets with their names and values', async () => {
    const res = await exportOf(SET_ID);

    expect(JSON.parse(res.body).limits).toEqual([{ name: 'pageSize', value: 20 }]);
    expect(JSON.parse(res.body).offsets).toEqual([]);
  });

  it('answers a set from its current version', async () => {
    const payload = JSON.parse((await exportOf(SET_ID)).body);
    expect(payload.arguments[0].arguments.bindings[0].term.value).toBe('rdf-star');
  });

  it('answers a version IRI from that version, not from the set current one', async () => {
    const res = await exportOf(V1);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.arguments[0].arguments.bindings[0].term.value).toBe('shacl');
    // v2's limit belongs to v2 alone.
    expect(payload.limits).toEqual([]);
  });

  it('404s an id that names nothing', async () => {
    const res = await exportOf('urn:sqlib:argument-set:missing');
    expect(res.statusCode).toBe(404);
  });

  it('409s a set that has no current version yet', async () => {
    store.set(SET_ID, { ...store.get(SET_ID)!, currentVersion: undefined });

    const res = await exportOf(SET_ID);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/no current version/);
  });
});
