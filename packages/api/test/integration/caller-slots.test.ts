/**
 * The caller's identity slots, against a real API instance.
 *
 * A saved query reads who is calling it through `VALUES ?authUser { UNDEF }`
 * and `VALUES ?authGroup { UNDEF }`, which sqlib fills from the sign-in and no
 * argument can set (`docs/guides/publishing-tools.md`, "The caller").
 *
 * The server runs with auth disabled, so a request with no token is "no one".
 * A test hook stands in for a verified token: `Authorization: Bearer as:<name>`
 * signs the request in as `urn:sqlib:principal:user:<name>`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AuthContext } from '../../src/auth/types.js';

type Json = ReturnType<typeof JSON.parse>;

const EX = 'http://example.org/';
const principal = (name: string) => `urn:sqlib:principal:user:${name}`;
const GROUP_EDITORS = 'urn:sqlib:principal:group:editors';

/** A signed-in context with admin grants, so only the slots decide the answers. */
function signedIn(name: string): AuthContext {
  const user = principal(name);
  const groups = name === 'alice' ? [GROUP_EDITORS] : [];
  return {
    subject: user,
    principals: [user, ...groups, 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: { admin: true, backends: new Map(), libraries: new Map() },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

const MINE = `PREFIX ex: <${EX}>
SELECT ?record WHERE {
  VALUES ?authUser { UNDEF }
  ?me ex:signsInAs ?authUser .
  ?record ex:owner ?me .
} ORDER BY ?record`;

const MY_GROUPS = `SELECT ?group WHERE { VALUES ?authGroup { UNDEF } BIND(?authGroup AS ?group) }`;

// The approve example from the guide: the link to a person is a flag of its
// own, so a caller with no link is refused rather than matched to any owner.
const APPROVE = `PREFIX ex: <${EX}>
DELETE { ?record ex:state ex:proposed }
INSERT { ?record ex:state ex:approved ; ex:approvedBy ?actor }
WHERE {
  VALUES ?record { UNDEF }
  VALUES ?authUser { UNDEF }
  OPTIONAL { ?actor ex:signsInAs ?authUser }
  BIND(BOUND(?actor) AS ?ok_linked)
  BIND(EXISTS { ?record ex:state ex:proposed } AS ?ok_proposed)
  BIND(?ok_linked && EXISTS { ?record ex:owner ?actor } AS ?ok_byOwner)
  BIND(?ok_linked && ?ok_proposed && ?ok_byOwner AS ?ok)
  FILTER(?ok)
}`;

const approveTool = {
  name: 'approve',
  description: 'Approve a proposed record. Only its owner may.',
  params: { record: { kind: 'iri', required: true } },
  refusals: {
    linked: 'Refused: your sign-in is not linked to a person.',
    proposed: 'Refused: {record} is not proposed.',
    byOwner: 'Refused: only the owner of {record} may approve it.',
  },
};

describe('the caller\'s identity slots', () => {
  const teardowns: Array<() => Promise<void>> = [];
  let outputDir: string;
  let author: FastifyInstance;
  const ids: Record<string, string> = {};

  const previousEnv: Record<string, string | undefined> = {};
  const setEnv = (key: string, value: string | undefined) => {
    if (!(key in previousEnv)) previousEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  async function startServer(): Promise<FastifyInstance> {
    const { configureApp } = await import('../../src/index.js');
    const app = Fastify({ logger: false });
    const { teardown } = await configureApp(app as never, { enableCacheMonitoring: false, registerSwagger: false });
    // Runs after the auth plugin's hook, so it replaces the full-access context.
    app.addHook('onRequest', async (request: FastifyRequest) => {
      const match = /^Bearer as:(\w+)$/.exec(request.headers.authorization ?? '');
      if (match) request.authContext = signedIn(match[1]);
    });
    teardowns.push(teardowns.length === 0 ? teardown : () => app.close());
    await app.ready();
    return app;
  }

  const send = async (app: FastifyInstance, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, as?: string) => {
    const response = await app.inject({
      method,
      url,
      ...(payload ? { payload } : {}),
      ...(as ? { headers: { authorization: `Bearer as:${as}` } } : {}),
    });
    return {
      status: response.statusCode,
      headers: response.headers,
      body: (response.body ? response.json() : null) as Json,
    };
  };

  const newQuery = async (name: string) => {
    const query = await send(author, 'POST', '/queries', { name, isPartOf: [ids.library], defaultBackend: ids.backend });
    expect(query.status).toBe(201);
    return query.body.id as string;
  };
  const saveVersion = (queryId: string, queryVersion: Json) =>
    send(author, 'POST', `/queries/${encodeURIComponent(queryId)}/versions`, { queryVersion });

  const records = (body: Json) => body.results.bindings.map((b: Json) => b.record.value);

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'caller-slots-'));
    setEnv('FEATURE_QUERIES', 'true');
    setEnv('FEATURE_BACKENDS', 'true');
    setEnv('FEATURE_DATA_GRAPHS', 'true');
    setEnv('INTERNAL_BACKEND_TYPE', 'oxigraph-memory');
    setEnv('OXIGRAPH_STORAGE_DIR', path.join(outputDir, 'oxigraph'));
    setEnv('MCP_CATALOGUE', undefined);
    const { oxigraphStoreManager } = await import('../../src/lib/OxigraphStoreManager.js');
    await oxigraphStoreManager.initialize(path.join(outputDir, 'oxigraph'));
    author = await startServer();

    const library = await send(author, 'POST', '/libraries', { name: 'Records', slug: 'records' });
    expect(library.status).toBe(201);
    ids.library = library.body.id;

    const dataGraph = await send(author, 'POST', '/data-graphs', { name: 'Records', isPartOf: [ids.library] });
    ids.dataGraph = dataGraph.body.id;
    await send(author, 'POST', `/data-graphs/${encodeURIComponent(ids.dataGraph)}/versions`, {
      contentString: `@prefix ex: <${EX}> .
        ex:alice ex:signsInAs <${principal('alice')}> .
        ex:bob ex:signsInAs <${principal('bob')}> .
        ex:rec1 ex:owner ex:alice ; ex:state ex:proposed .
        ex:rec2 ex:owner ex:alice ; ex:state ex:proposed .
        ex:rec3 ex:owner ex:bob ; ex:state ex:proposed .`,
      contentFormat: 'text/turtle',
    });
    const backend = await send(author, 'POST', '/backends', {
      name: 'Records store',
      backendType: 'oxigraphMemory',
      oxigraphConfig: JSON.stringify({ storeType: 'ephemeral', mode: 'ephemeral', sources: [{ dataGraphId: ids.dataGraph }] }),
    });
    expect(backend.status).toBe(201);
    ids.backend = backend.body.id;

    ids.mine = await newQuery('My records');
    expect((await saveVersion(ids.mine, { queryString: MINE })).status).toBe(201);
    ids.groups = await newQuery('My groups');
    expect((await saveVersion(ids.groups, { queryString: MY_GROUPS })).status).toBe(201);
    ids.approve = await newQuery('Approve');
  }, 120_000);

  afterAll(async () => {
    for (const teardown of teardowns.reverse()) await teardown();
    await fs.rm(outputDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('POST /execute', () => {
    const run = (targetId: string, as?: string, extra: object = {}) =>
      send(author, 'POST', '/execute', { targetId, backendId: ids.backend, ...extra }, as);

    it('fills ?authUser with the signed-in caller', async () => {
      const alice = await run(ids.mine, 'alice');
      expect(alice.status).toBe(200);
      expect(records(alice.body)).toEqual([`${EX}rec1`, `${EX}rec2`]);
      expect(alice.headers['cache-control']).toBe('private, no-store');

      const bob = await run(ids.mine, 'bob');
      expect(records(bob.body)).toEqual([`${EX}rec3`]);

      // Signed in, but linked to no person in the data: nothing matches.
      const carol = await run(ids.mine, 'carol');
      expect(records(carol.body)).toEqual([]);
    });

    it('fills ?authGroup with one row per group, and zero rows for none', async () => {
      const alice = await run(ids.groups, 'alice');
      expect(alice.body.results.bindings.map((b: Json) => b.group.value)).toEqual([GROUP_EDITORS]);
      const bob = await run(ids.groups, 'bob');
      expect(bob.body.results.bindings).toEqual([]);
    });

    it('refuses to run when no one is signed in', async () => {
      const nobody = await run(ids.mine);
      expect(nobody.status).toBe(403);
      expect(nobody.body.error).toMatch(/reads the signed-in caller \(\?authUser\)/);
    });

    it('refuses an argument that sets a slot', async () => {
      const forged = await run(ids.mine, 'bob', {
        arguments: [{ head: { vars: ['authUser'] }, results: { bindings: [{ authUser: { type: 'uri', value: principal('alice') } }] } }],
      });
      expect(forged.status).toBe(400);
      expect(forged.body.error).toMatch(/filled from the caller's sign-in/);
    });

    it('fills ad-hoc text on POST /sparql the same way', async () => {
      const response = await send(author, 'POST', '/sparql', { backendId: ids.backend, query: MINE }, 'bob');
      expect(response.status).toBe(200);
      expect(records(response.body)).toEqual([`${EX}rec3`]);
    });
  });

  describe('save-time checks', () => {
    it('refuses a slot inside a multi-variable VALUES', async () => {
      const response = await saveVersion(await newQuery('Zipped'), {
        queryString: 'SELECT * WHERE { VALUES (?authUser ?x) { (UNDEF UNDEF) } }',
      });
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/must be declared on its own/);
    });

    it('refuses a tool parameter named after a slot', async () => {
      const response = await saveVersion(ids.approve, {
        queryString: APPROVE,
        tool: { ...approveTool, params: { ...approveTool.params, authUser: { kind: 'iri' } } },
      });
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/^tool\.params\.authUser: \?authUser is filled from the caller's sign-in/);
    });

    it('refuses an argument set that binds a slot', async () => {
      const response = await send(author, 'POST', `/queries/${encodeURIComponent(ids.mine)}/argument-sets`, {
        name: 'Forged',
        tupleBindings: [{ variables: ['authUser'], rows: [{ values: { authUser: { type: 'uri', value: principal('alice') } } }] }],
      });
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/cannot bind it/);
    });

    it('refuses a query that reads the caller as the source of a data graph', async () => {
      const construct = await newQuery('My records as a graph');
      const saved = await saveVersion(construct, {
        queryString: `PREFIX ex: <${EX}> CONSTRUCT { ?r ex:mine true } WHERE { VALUES ?authUser { UNDEF } ?me ex:signsInAs ?authUser . ?r ex:owner ?me }`,
      });
      expect(saved.status).toBe(201);
      const response = await send(author, 'POST', `/data-graphs/${encodeURIComponent(ids.dataGraph)}/versions/from-query`, {
        queryVersionId: saved.body.queryVersion.id,
        backendId: ids.backend,
      }, 'alice');
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/cannot depend on who runs it/);
    });

    it('saves the approve tool', async () => {
      const response = await saveVersion(ids.approve, { queryString: APPROVE, tool: approveTool });
      expect(response.status).toBe(201);
    });
  });

  describe('a published update that reads the caller', () => {
    let server: FastifyInstance;
    const approve = (record: string, as?: string) =>
      send(server, 'POST', '/tools/records/approve', { record: `${EX}${record}` }, as);

    beforeAll(async () => {
      server = await startServer();
    }, 120_000);

    it('does not offer the slot as a parameter', async () => {
      const document = await send(server, 'GET', '/tools/records/openapi.json');
      expect(document.status).toBe(200);
      const schema = document.body.paths['/tools/records/approve'].post.requestBody.content['application/json'].schema;
      expect(Object.keys(schema.properties).sort()).toEqual(['backendId', 'record']);
    });

    it('refuses a caller who sends the slot as an argument', async () => {
      const response = await send(server, 'POST', '/tools/records/approve', {
        record: `${EX}rec3`,
        authUser: principal('bob'),
      }, 'alice');
      expect(response.status).toBe(400);
    });

    it('refuses a caller who is not the owner, however it is called', async () => {
      const bob = await approve('rec1', 'bob');
      expect(bob.status).toBe(409);
      expect(bob.body.refused).toEqual([
        { flag: 'byOwner', message: `Refused: only the owner of ${EX}rec1 may approve it.` },
      ]);
    });

    it('refuses a caller with no link to a person', async () => {
      const carol = await approve('rec1', 'carol');
      expect(carol.status).toBe(409);
      expect(carol.body.refused.map((entry: Json) => entry.flag)).toEqual(['linked', 'byOwner']);
    });

    it('refuses when no one is signed in', async () => {
      const nobody = await approve('rec1');
      expect(nobody.status).toBe(403);
    });

    it('lets the owner approve, and records the approver from the sign-in', async () => {
      const alice = await approve('rec1', 'alice');
      expect(alice.status).toBe(204);

      const check = await send(server, 'POST', '/sparql', {
        backendId: ids.backend,
        query: `PREFIX ex: <${EX}> SELECT ?state ?by WHERE { ex:rec1 ex:state ?state . OPTIONAL { ex:rec1 ex:approvedBy ?by } }`,
      }, 'alice');
      expect(check.body.results.bindings).toEqual([
        { state: { type: 'uri', value: `${EX}approved` }, by: { type: 'uri', value: `${EX}alice` } },
      ]);

      const again = await approve('rec1', 'alice');
      expect(again.status).toBe(409);
      expect(again.body.refused.map((entry: Json) => entry.flag)).toEqual(['proposed']);
    });
  });
});
