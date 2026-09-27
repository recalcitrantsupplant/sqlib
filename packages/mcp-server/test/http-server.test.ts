/**
 * The streamable-HTTP transport's contract: sessions are created only by an
 * `initialize`, a stale id gets 404 so the client re-initialises, a session
 * belongs to the caller that created it, and `/mcp` reflects only allowlisted
 * browser origins.
 *
 * Runs a real listener on an ephemeral port: the SDK transport writes to the
 * raw Node response (SSE), which `inject` does not model faithfully. The first
 * session also pays for loading the API module and compiling tool validators
 * (memoised afterwards), hence the generous timeouts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import {
  buildStreamableHttpMcpServer,
  resolveCorsPolicy,
  type CorsPolicy,
} from '../src/http-server.js';
import { resetAuthConfig } from '../../api/src/auth/config.js';
import { registerAuthPlugin } from '../../api/src/auth/plugin.js';

const PROTOCOL_VERSION = '2025-06-18';
const ALICE = 'Bearer alice-token';
const MALLORY = 'Bearer mallory-token';

type Harness = Awaited<ReturnType<typeof buildStreamableHttpMcpServer>> & { url: string };

const running: Harness[] = [];

afterEach(async () => {
  while (running.length) await running.pop()!.shutdown();
  resetAuthConfig({} as NodeJS.ProcessEnv);
});

async function startHarness(
  options: { corsPolicy?: CorsPolicy; initTimeoutMs?: number; prepare?: (app: FastifyInstance) => Promise<void> } = {},
): Promise<Harness> {
  const app = Fastify({ logger: false });
  await options.prepare?.(app);
  // Stands in for the API route `libraries_list` calls, and echoes the bearer
  // so the test can see the caller's token rode the inject.
  app.get('/libraries', async (request) => ({ authorization: request.headers.authorization ?? null }));
  // A REST route beside /mcp, to pin content-type behaviour outside it.
  app.post('/rest', async (request) => ({ body: request.body }));

  const built = await buildStreamableHttpMcpServer({
    fastifyInstance: app,
    bootstrapApiApp: false,
    corsPolicy: options.corsPolicy ?? { any: false, origins: new Set() },
    initTimeoutMs: options.initTimeoutMs,
    mcpOptions: { fastifyInstance: app, skipAppSetup: true, fastifyLogger: false },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  const harness = { ...built, url: `http://127.0.0.1:${port}/mcp` };
  running.push(harness);
  return harness;
}

const initializeMessage = (id = 1) => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'http-server.test', version: '0.0.0' },
  },
});

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** The JSON-RPC message in a response, whether sent as JSON or as one SSE event. */
async function rpcResult(response: Response): Promise<any> {
  const text = await response.text();
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .filter(Boolean);
    return JSON.parse(data[data.length - 1]);
  }
  return JSON.parse(text);
}

async function initialise(url: string, authorization?: string) {
  const auth: Record<string, string> = authorization ? { authorization } : {};
  const response = await post(url, initializeMessage(), auth);
  expect(response.status).toBe(200);
  const sessionId = response.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();
  const init = await rpcResult(response);
  expect(init.result.protocolVersion).toBe(PROTOCOL_VERSION);

  const headers: Record<string, string> = {
    ...auth,
    'mcp-session-id': sessionId!,
    'mcp-protocol-version': PROTOCOL_VERSION,
  };
  const initialized = await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, headers);
  expect(initialized.status).toBe(202);
  return { sessionId: sessionId!, headers };
}

describe('MCP streamable HTTP transport', { timeout: 30_000 }, () => {
  it('initialises, lists and calls tools, then deletes the session', async () => {
    const { url, sessions } = await startHarness();
    const { sessionId, headers } = await initialise(url, ALICE);
    expect(sessions.size).toBe(1);

    const list = await rpcResult(await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, headers));
    const names = list.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('libraries_list');

    const call = await rpcResult(
      await post(
        url,
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'libraries_list', arguments: {} } },
        headers,
      ),
    );
    expect(call.result.structuredContent.statusCode).toBe(200);
    expect(call.result.structuredContent.body).toEqual({ authorization: ALICE });

    const deleted = await fetch(url, { method: 'DELETE', headers });
    expect(deleted.status).toBe(204);
    expect(sessions.size).toBe(0);
    expect(sessions.has(sessionId)).toBe(false);

    // The deleted id is now stale.
    const after = await post(url, { jsonrpc: '2.0', id: 4, method: 'tools/list' }, headers);
    expect(after.status).toBe(404);
  });

  it('answers an unknown session id with 404 on POST, GET and DELETE', async () => {
    const { url, sessions } = await startHarness();
    const stale = { 'mcp-session-id': 'not-a-session', 'mcp-protocol-version': PROTOCOL_VERSION };

    const postResponse = await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, stale);
    expect(postResponse.status).toBe(404);
    expect((await postResponse.json()).error.code).toBe(-32001);

    // Even an initialize carrying a stale id is told to drop it, not handed a
    // fresh session under the old name.
    expect((await post(url, initializeMessage(), stale)).status).toBe(404);

    expect((await fetch(url, { headers: { accept: 'text/event-stream', ...stale } })).status).toBe(404);
    expect((await fetch(url, { method: 'DELETE', headers: stale })).status).toBe(404);
    expect(sessions.size).toBe(0);
  });

  it('refuses a non-initialize POST without a session and allocates nothing', async () => {
    const { url, sessions } = await startHarness();
    for (let id = 1; id <= 5; id += 1) {
      const response = await post(url, { jsonrpc: '2.0', id, method: 'tools/list' });
      expect(response.status).toBe(400);
    }
    expect(sessions.size).toBe(0);
  });

  it('does not register a transport whose initialize the SDK refuses', async () => {
    const { url, sessions } = await startHarness();
    // Missing text/event-stream in Accept: the transport answers 406.
    const response = await post(url, initializeMessage(), { accept: 'application/json' });
    expect(response.status).toBe(406);
    expect(sessions.size).toBe(0);
  });

  it('binds a session to its creator: another bearer gets 403 and cannot delete it', async () => {
    const { url, sessions } = await startHarness();
    const { sessionId, headers } = await initialise(url, ALICE);
    const asMallory = { ...headers, authorization: MALLORY };

    const posted = await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, asMallory);
    expect(posted.status).toBe(403);

    const attached = await fetch(url, { headers: { accept: 'text/event-stream', ...asMallory } });
    expect(attached.status).toBe(403);

    const deleted = await fetch(url, { method: 'DELETE', headers: asMallory });
    expect(deleted.status).toBe(403);

    // No bearer at all is a different caller too.
    const { authorization: _drop, ...anonymous } = headers;
    expect((await post(url, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, anonymous)).status).toBe(403);

    expect(sessions.has(sessionId)).toBe(true);
    const stillAlice = await post(url, { jsonrpc: '2.0', id: 4, method: 'tools/list' }, headers);
    expect(stillAlice.status).toBe(200);
    await stillAlice.text();
  });

  it('keeps the catch-all body parser off REST routes', async () => {
    const { url } = await startHarness();
    const rest = url.replace(/\/mcp$/, '/rest');
    const response = await fetch(rest, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
    // Fastify's default for text/plain is a string parser; an unknown type is 415.
    expect(response.status).toBe(200);
    const unknown = await fetch(rest, {
      method: 'POST',
      headers: { 'content-type': 'application/x-unknown' },
      body: 'x',
    });
    expect(unknown.status).toBe(415);
  });
});

describe('MCP CORS', { timeout: 30_000 }, () => {
  const allowed = 'http://localhost:3001';
  const policy: CorsPolicy = { any: false, origins: new Set([allowed]) };

  it('gives a disallowed origin no access-control-allow-origin', async () => {
    const { url } = await startHarness({ corsPolicy: policy });
    const response = await post(url, initializeMessage(), { origin: 'https://evil.example' });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    await response.text();

    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('echoes a listed origin with credentials, and answers its preflight', async () => {
    const { url } = await startHarness({ corsPolicy: policy });
    const response = await post(url, initializeMessage(), { origin: allowed });
    expect(response.headers.get('access-control-allow-origin')).toBe(allowed);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('access-control-expose-headers')).toContain('mcp-session-id');
    await response.text();

    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        origin: allowed,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, mcp-session-id',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(allowed);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('DELETE');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('mcp-session-id');
  });

  it('never sends credentials for the * wildcard', async () => {
    const { url } = await startHarness({ corsPolicy: { any: true, origins: new Set() } });
    const response = await post(url, initializeMessage(), { origin: 'https://anyone.example' });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    await response.text();
  });

  it('parses SQLIB_CORS_ORIGINS, defaulting to the SPA dev origin in development only', () => {
    expect([...resolveCorsPolicy({ NODE_ENV: 'production' }).origins]).toEqual([]);
    expect(resolveCorsPolicy({}).origins.size).toBe(0);
    expect(resolveCorsPolicy({ NODE_ENV: 'development' }).origins.has('http://localhost:3001')).toBe(true);
    const listed = resolveCorsPolicy({
      NODE_ENV: 'development',
      SQLIB_CORS_ORIGINS: 'https://a.example/, https://b.example',
    });
    expect([...listed.origins]).toEqual(['https://a.example', 'https://b.example']);
    expect(listed.any).toBe(false);
    expect(resolveCorsPolicy({ SQLIB_CORS_ORIGINS: '*' })).toEqual({ any: true, origins: new Set() });
    expect(resolveCorsPolicy({ NODE_ENV: 'development', SQLIB_CORS_ORIGINS: '' }).origins.size).toBe(0);
  });
});

describe('MCP under SQLIB_AUTH_MODE=required', { timeout: 30_000 }, () => {
  it('refuses /mcp without a bearer before any session is created', async () => {
    const { url, sessions } = await startHarness({
      // Mirrors dual-http: the API's auth plugin's onRequest hook is on the
      // shared instance ahead of the MCP routes.
      prepare: async (app) => {
        resetAuthConfig({
          SQLIB_AUTH_MODE: 'required',
          SQLIB_AUTH_ISSUER: 'https://issuer.test/',
          SQLIB_AUTH_AUDIENCE: 'sqlib-api',
          SQLIB_AUTH_JWKS_URI: 'https://issuer.test/jwks',
        } as NodeJS.ProcessEnv);
        await registerAuthPlugin(app);
      },
    });
    const response = await post(url, initializeMessage());
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/^Bearer/);
    expect(sessions.size).toBe(0);
  });
});
