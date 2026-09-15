/**
 * What the library routes show a caller, against the real plugin.
 *
 * `libraries.ts` registers no entity guard — the entity in the path *is* the
 * library, so every check is the handler's own — and two of them were decided
 * by a request header rather than by a grant:
 *
 * - `GET /libraries/:id` checked Read in its JSON branch and not in the RDF
 *   branch above it, so `Accept: text/turtle` read a library the same request
 *   without the header is refused.
 * - `GET /libraries` filtered its JSON with `filterReadable` and answered the
 *   RDF branch with `libraryCollection`, which constructs from every stored
 *   `Library` in the deployment. `GET /libraries/export` is that query again
 *   with no check at all.
 *
 * The fourth block is the export bundle, which is the same question one hop
 * further out: a group belongs to the library being exported, but its nodes
 * name query versions that need not, and the bundle carries each node's query
 * text. Read here was a read of the other library's queries.
 *
 * The RDF branches are asserted through the system query the route runs — which
 * query, and bound to which libraries — because the triples themselves come
 * from the store and a mocked stream would only be asserting the fixture.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext, BackendMode, LibraryMode } from '../../src/auth/types.js';

const MINE = 'urn:sqlib:library:hydrology';
const THEIRS = 'urn:sqlib:library:payroll';

const { entities, systemQueryExecute, exportRuntimePayload, grantsMinted } = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
  systemQueryExecute: vi.fn(),
  exportRuntimePayload: vi.fn(),
  grantsMinted: vi.fn(),
}));

const byType = (type: string) =>
  [...entities.values()].filter(entity => entity['@type'] === type);

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => {
  const repo = (type: string) => ({
    get: (id: string) => {
      const entity = entities.get(id);
      return entity && entity['@type'] === type ? entity : null;
    },
    list: () => byType(type),
    // Write-through the way the coordinator does it: no existence check on
    // create, and the cache entry replaced outright — which is the behaviour
    // `POST /libraries` leaned on. See `CacheCoordinator.create`.
    create: async (entity: Record<string, unknown>) => {
      const stored = { ...entity, '@type': type };
      entities.set(entity.$id as string, stored);
      return stored;
    },
    update: async (id: string, updates: Record<string, unknown>) => {
      const current = entities.get(id);
      if (!current) return null;
      const stored = { ...current, ...updates };
      entities.set(id, stored);
      return stored;
    },
  });
  return {
    getCacheCoordinator: () => ({ get: (id: string) => entities.get(id) ?? null }),
    getEntityRepositories: () => ({
      Library: repo('Library'),
      Query: repo('Query'),
      QueryVersion: repo('QueryVersion'),
      QueryGroup: repo('QueryGroup'),
      QueryGroupVersion: repo('QueryGroupVersion'),
      Test: repo('Test'),
      TestVersion: repo('TestVersion'),
      TestCase: repo('TestCase'),
    }),
  };
});

vi.mock('../../src/lib/system-queries/SystemQueryRunner.js', () => ({
  SystemQueryRunner: vi.fn(function () {
    return { execute: systemQueryExecute };
  }),
}));

vi.mock('../../src/auth/AuthStore.js', () => ({
  getAuthStore: () => ({
    createGrant: grantsMinted,
    deleteGrantsForLibrary: vi.fn(),
  }),
}));

vi.mock('../../src/lib/ArgumentSetService.js', () => ({
  ArgumentSetService: vi.fn(function () {
    return { exportRuntimePayload };
  }),
}));

function contextFor(
  libraries: Record<string, LibraryMode[]>,
  backends: Record<string, BackendMode[]> = {}
): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller', 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map(
        Object.entries(backends).map(([backend, modes]) => [backend, new Set(modes)])
      ),
      libraries: new Map(
        Object.entries(libraries).map(([library, modes]) => [library, new Set(modes)])
      ),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

const reader = contextFor({ [MINE]: ['read'] });
const stranger = contextFor({});
const bothLibraries = contextFor({ [MINE]: ['read'], [THEIRS]: ['read'] });
const owner = contextFor({ [MINE]: ['read', 'write', 'execute', 'delete', 'control'] });
/** Auth switched off: the shape every existing unit test in this package runs as. */
const authDisabled: AuthContext = {
  ...stranger,
  subject: 'urn:sqlib:principal:anonymous',
  principals: [],
  issuer: null,
  fullAccess: true,
  mode: 'disabled',
};

async function request(
  context: AuthContext,
  url: string,
  headers: Record<string, string> = {},
  options: { method?: 'GET' | 'POST' | 'PUT'; payload?: unknown } = {}
) {
  const app: FastifyInstance = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
  }
  app.decorateRequest('authContext', undefined);
  app.addHook('onRequest', async req => {
    req.authContext = context;
  });
  const plugin = (await import('../../src/routes/libraries.js')).default;
  await app.register(plugin as never, { prefix: '/libraries' });
  await app.ready();
  const response = await app.inject({
    method: options.method ?? 'GET',
    url,
    headers,
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
  await app.close();
  return response;
}

/** The IRIs a `libraryDescribe` run was bound to, in order. */
function describedLibraries(): string[] {
  const call = systemQueryExecute.mock.calls.at(-1);
  expect(call?.[0]).toBe('libraryDescribe');
  const bindings = call?.[1]?.parameterBindings?.[0]?.bindings ?? [];
  return bindings.map((row: Record<string, { value: string }>) => row.library.value);
}

const TURTLE = { accept: 'text/turtle' };

beforeEach(() => {
  vi.clearAllMocks();
  entities.clear();
  entities.set(MINE, { '@type': 'Library', $id: MINE, name: 'Hydrology' });
  entities.set(THEIRS, { '@type': 'Library', $id: THEIRS, name: 'Payroll' });
  systemQueryExecute.mockResolvedValue({
    mode: 'stream',
    contentType: 'text/turtle',
    stream: { statusCode: 200, headers: { 'content-type': 'text/turtle' }, body: Readable.from('') },
  });
});

describe('GET /libraries/:id', () => {
  it('refuses an RDF read of a library the caller may not read', async () => {
    const response = await request(stranger, `/libraries/${encodeURIComponent(MINE)}`, TURTLE);

    expect(response.statusCode).toBe(403);
    expect(systemQueryExecute).not.toHaveBeenCalled();
  });

  it('refuses it in JSON too — the header is not the difference', async () => {
    const response = await request(stranger, `/libraries/${encodeURIComponent(MINE)}`);

    expect(response.statusCode).toBe(403);
  });

  it('describes the library for a caller holding Read on it', async () => {
    const response = await request(reader, `/libraries/${encodeURIComponent(MINE)}`, TURTLE);

    expect(response.statusCode).toBe(200);
    expect(describedLibraries()).toEqual([MINE]);
  });

  it('still 404s a library that does not exist, before the check', async () => {
    const response = await request(reader, '/libraries/urn:sqlib:library:gone', TURTLE);

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /libraries (RDF)', () => {
  it('describes only the libraries the caller may read', async () => {
    const response = await request(reader, '/libraries', TURTLE);

    expect(response.statusCode).toBe(200);
    expect(describedLibraries()).toEqual([MINE]);
  });

  it('answers a caller who may read none with an empty document, not a 403', async () => {
    const response = await request(stranger, '/libraries', TURTLE);

    expect(response.statusCode).toBe(200);
    expect(describedLibraries()).toEqual([]);
  });

  it('dumps the collection when nothing was filtered out', async () => {
    await request(bothLibraries, '/libraries', TURTLE);

    expect(systemQueryExecute.mock.calls.at(-1)?.[0]).toBe('libraryCollection');
  });

  it('lists only readable libraries in JSON, as it already did', async () => {
    const response = await request(reader, '/libraries');

    expect(response.statusCode).toBe(200);
    expect(response.json().map((library: { id: string }) => library.id)).toEqual([MINE]);
  });
});

describe('GET /libraries/export', () => {
  it('exports only the libraries the caller may read', async () => {
    const response = await request(reader, '/libraries/export', TURTLE);

    expect(response.statusCode).toBe(200);
    expect(describedLibraries()).toEqual([MINE]);
  });

  it('exports nothing for a caller holding no grant anywhere', async () => {
    const response = await request(stranger, '/libraries/export', TURTLE);

    expect(response.statusCode).toBe(200);
    expect(describedLibraries()).toEqual([]);
  });

  it('is the whole collection when auth is switched off', async () => {
    await request(authDisabled, '/libraries/export', TURTLE);

    expect(systemQueryExecute.mock.calls.at(-1)?.[0]).toBe('libraryCollection');
  });
});

const BACKEND = 'urn:sqlib:backend:warehouse';

describe('POST /libraries', () => {
  it('refuses to create over a library that already exists', async () => {
    const response = await request(stranger, '/libraries', {}, {
      method: 'POST',
      payload: { id: THEIRS, name: 'Mine now' },
    });

    expect(response.statusCode).toBe(409);
    // Neither half of the takeover: the record is untouched and no grant on it
    // was minted for the caller.
    expect(entities.get(THEIRS)).toMatchObject({ name: 'Payroll' });
    expect(grantsMinted).not.toHaveBeenCalled();
  });

  it('mints an id and the creator’s grants for an ordinary create', async () => {
    const response = await request(stranger, '/libraries', {}, {
      method: 'POST',
      payload: { name: 'Field notes' },
    });

    expect(response.statusCode).toBe(201);
    expect(grantsMinted).toHaveBeenCalledWith(
      expect.objectContaining({ resourceKind: 'library', modes: expect.arrayContaining(['control']) }),
    );
  });

  it('refuses to curate a backend the creator may not use', async () => {
    const response = await request(stranger, '/libraries', {}, {
      method: 'POST',
      payload: { name: 'Field notes', allowedBackends: [BACKEND] },
    });

    expect(response.statusCode).toBe(403);
    expect(grantsMinted).not.toHaveBeenCalled();
  });

  it('refuses it as a defaultBackend too', async () => {
    const response = await request(stranger, '/libraries', {}, {
      method: 'POST',
      payload: { name: 'Field notes', defaultBackend: BACKEND },
    });

    expect(response.statusCode).toBe(403);
  });

  it('allows a backend the creator holds Use on', async () => {
    const withBackend = contextFor({}, { [BACKEND]: ['use'] });
    const response = await request(withBackend, '/libraries', {}, {
      method: 'POST',
      payload: { name: 'Field notes', allowedBackends: [BACKEND] },
    });

    expect(response.statusCode).toBe(201);
  });
});

describe('PUT /libraries/:id', () => {
  it('refuses a defaultBackend the caller may not use', async () => {
    const response = await request(owner, `/libraries/${encodeURIComponent(MINE)}`, {}, {
      method: 'PUT',
      payload: { name: 'Hydrology', defaultBackend: BACKEND },
    });

    expect(response.statusCode).toBe(403);
    expect(entities.get(MINE)).not.toMatchObject({ defaultBackend: BACKEND });
  });

  it('allows one the caller holds Use on', async () => {
    const withBackend = contextFor(
      { [MINE]: ['read', 'write', 'control'] },
      { [BACKEND]: ['use'] },
    );
    const response = await request(withBackend, `/libraries/${encodeURIComponent(MINE)}`, {}, {
      method: 'PUT',
      payload: { name: 'Hydrology', defaultBackend: BACKEND },
    });

    expect(response.statusCode).toBe(200);
  });

  it('leaves an unrelated update alone', async () => {
    const response = await request(owner, `/libraries/${encodeURIComponent(MINE)}`, {}, {
      method: 'PUT',
      payload: { name: 'Hydrology and gauges' },
    });

    expect(response.statusCode).toBe(200);
  });
});

/**
 * One group in MINE whose second node runs a query version belonging to THEIRS.
 *
 * Written as the entities a store holds, because that graph is what the export
 * walks: nodes, edges, tuples, members and the variables the members name.
 */
function seedCrossLibraryGroup() {
  const tuple = (id: string, type: string, name: string) => {
    entities.set(id, { '@type': type, memberEntries: [`${id}-m`] });
    entities.set(`${id}-m`, { '@type': 'TupleMember', position: 0, variable: `${id}-v` });
    entities.set(`${id}-v`, {
      '@type': type === 'QueryOutputTuple' ? 'QueryOutputVariable' : 'QueryInputVariable',
      variableName: name,
    });
  };

  entities.set('g1', {
    '@type': 'QueryGroup',
    $id: 'g1',
    name: 'Gauges and their operators',
    isPartOf: MINE,
    currentVersion: 'gv1',
  });
  entities.set('gv1', {
    '@type': 'QueryGroupVersion',
    $id: 'gv1',
    isPartOf: 'g1',
    version: 1,
    startNode: 'start',
    endNode: 'end',
    executionNodes: ['n1', 'n2'],
    edges: ['e1', 'e2'],
  });
  entities.set('start', { '@type': 'StartNode' });
  entities.set('end', { '@type': 'EndNode' });
  entities.set('n1', { '@type': 'QueryNode', queryId: 'mine-v1' });
  entities.set('n2', { '@type': 'QueryNode', queryId: 'theirs-v1' });
  entities.set('mine-v1', {
    '@type': 'QueryVersion',
    $id: 'mine-v1',
    isPartOf: 'mine-q1',
    version: 1,
    queryString: 'SELECT ?gauge WHERE { VALUES (?basin) { (UNDEF) } ?gauge <urn:in> ?basin . }',
  });
  entities.set('theirs-v1', {
    '@type': 'QueryVersion',
    $id: 'theirs-v1',
    isPartOf: 'theirs-q1',
    version: 1,
    queryString: 'SELECT ?operator WHERE { VALUES (?gauge) { (UNDEF) } ?gauge <urn:paidBy> ?operator . }',
  });
  entities.set('mine-q1', { '@type': 'Query', $id: 'mine-q1', name: 'Gauges', isPartOf: [MINE] });
  entities.set('theirs-q1', {
    '@type': 'Query',
    $id: 'theirs-q1',
    name: 'Operators',
    isPartOf: [THEIRS],
  });
  tuple('in-basin', 'QueryInputTuple', 'basin');
  tuple('in-gauge', 'QueryInputTuple', 'gauge');
  tuple('out-gauge', 'QueryOutputTuple', 'gauge');
  tuple('out-operator', 'QueryOutputTuple', 'operator');
  entities.set('e1', {
    '@type': 'QueryEdge',
    sourceNodeId: 'n1',
    targetNodeId: 'n2',
    dataFlowType: 'VARIABLE_BINDINGS',
    sourceOutputId: 'out-gauge',
    targetInputId: 'in-gauge',
  });
  entities.set('e2', {
    '@type': 'QueryEdge',
    sourceNodeId: 'n2',
    targetNodeId: 'end',
    dataFlowType: 'VARIABLE_BINDINGS',
    sourceOutputId: 'out-operator',
    targetInputId: 'out-operator',
  });
}

describe('GET /libraries/:id/export-bundle', () => {
  const url = `/libraries/${encodeURIComponent(MINE)}/export-bundle`;

  beforeEach(() => {
    seedCrossLibraryGroup();
  });

  it("withholds a group whose leg runs another library's query", async () => {
    const response = await request(reader, url);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(JSON.stringify(body.bundle)).not.toContain('urn:paidBy');
    expect(body.skipped).toContainEqual(
      expect.objectContaining({
        id: 'g1',
        reason: expect.stringContaining('a library you may not read'),
      }),
    );
  });

  it('carries the same group for a caller who may read both libraries', async () => {
    const response = await request(bothLibraries, url);

    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json().bundle)).toContain('urn:paidBy');
  });

  it('refuses the bundle outright when the library itself is unreadable', async () => {
    const response = await request(stranger, url);

    expect(response.statusCode).toBe(403);
  });
});
