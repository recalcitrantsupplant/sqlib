/**
 * Published tools over MCP: `/mcp` lists them as `{slug}__{name}` beside the
 * catalogue, `/mcp/{slug}` lists one library's alone under their own names,
 * and `MCP_CATALOGUE` takes either surface away.
 *
 * The catalogue the API collects at startup is put on the instance by hand
 * here, and `/execute` echoes the body it receives, so what is asserted is
 * what this package does with a published tool: list it, validate the call,
 * and send the request the tools package builds.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AddressInfo } from 'node:net';
import type { PublishedToolSpec } from '@sparql-query-lib/tools';
import { buildStreamableHttpMcpServer } from '../src/http-server.js';
import type { PublishedSurface } from '../src/index.js';

const PROTOCOL_VERSION = '2025-06-18';

const byCity: PublishedToolSpec = {
  slug: 'people',
  libraryId: 'urn:sqlib:library:people',
  name: 'people-in-city',
  description: 'The people who live in a city.',
  targetId: 'urn:sqlib:query-version:by-city-2',
  targetKind: 'query',
  readOnly: true,
  params: { city: { kind: 'string', list: true, required: true } },
  inputs: { tables: [['city']], limits: [], offsets: [] },
  defaultBackendId: 'urn:sqlib:backend:people',
};

/** An update with refusals; the harness's `/execute` refuses it. */
const settle: PublishedToolSpec = {
  ...byCity,
  name: 'settle',
  description: 'Agree or decline a proposed item.',
  targetId: 'urn:sqlib:query-version:settle-1',
  readOnly: false,
  params: { item: { kind: 'iri', required: true } },
  inputs: { tables: [['item']], limits: [], offsets: [] },
  refusals: { proposed: 'Refused: {item} is not proposed.' },
};

const running: Array<{ shutdown: () => Promise<void> }> = [];
afterEach(async () => {
  while (running.length) await running.pop()!.shutdown();
});

async function startHarness(mode: PublishedSurface['mode']) {
  const app = Fastify({ logger: false });
  const surface: PublishedSurface = {
    catalogue: { specs: [byCity, settle], libraries: new Map([['people', { name: 'People', description: 'Who lives where.' }]]) },
    mode,
  };
  app.decorate('sqlibPublished', surface);
  app.post('/execute', async (request, reply) =>
    (request.body as { targetId?: string }).targetId === settle.targetId
      ? reply.code(409).send({
          error: 'Refused: urn:x is not proposed.',
          refused: [{ flag: 'proposed', message: 'Refused: urn:x is not proposed.' }],
        })
      : { received: request.body });

  const built = await buildStreamableHttpMcpServer({
    fastifyInstance: app,
    bootstrapApiApp: false,
    corsPolicy: { any: false, origins: new Set() },
    mcpOptions: { fastifyInstance: app, skipAppSetup: true, fastifyLogger: false },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  running.push(built);
  return `http://127.0.0.1:${port}`;
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** The JSON-RPC message in a response, as `JSON.parse` gives it. */
async function rpcResult(response: Response): Promise<ReturnType<typeof JSON.parse>> {
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

/** Open a session on `url` and return what `initialize` and `tools/list` said. */
async function connect(url: string) {
  const response = await post(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'published.test', version: '0' } },
  });
  expect(response.status).toBe(200);
  const init = await rpcResult(response);
  const headers = { 'mcp-session-id': response.headers.get('mcp-session-id')!, 'mcp-protocol-version': PROTOCOL_VERSION };
  await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, headers);
  const list = await rpcResult(await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, headers));
  const call = async (name: string, args: unknown) =>
    rpcResult(await post(url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }, headers));
  return { init, tools: list.result.tools as Array<{ name: string; annotations?: unknown }>, headers, call };
}

describe('published tools over MCP', { timeout: 30_000 }, () => {
  it('lists them on /mcp as slug__name beside the catalogue, and runs the pinned version', async () => {
    const base = await startHarness('both');
    const { tools, call } = await connect(`${base}/mcp`);
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('libraries_list');
    expect(names).toContain('people__people-in-city');
    expect(tools.find((tool) => tool.name === 'people__people-in-city')?.annotations).toEqual({ readOnlyHint: true });

    const result = await call('people__people-in-city', { city: ['Perth', 'Darwin'] });
    expect(result.result.structuredContent.body).toEqual({
      received: {
        targetId: 'urn:sqlib:query-version:by-city-2',
        backendId: 'urn:sqlib:backend:people',
        arguments: [
          {
            head: { vars: ['city'] },
            results: {
              bindings: [{ city: { type: 'literal', value: 'Perth' } }, { city: { type: 'literal', value: 'Darwin' } }],
            },
          },
        ],
      },
    });
  });

  it('lists one library alone on /mcp/{slug}, under the tools\' own names', async () => {
    const base = await startHarness('both');
    const { init, tools, call } = await connect(`${base}/mcp/people`);
    expect(tools.map((tool) => tool.name)).toEqual(['people-in-city', 'settle']);
    expect(init.result.instructions).toContain('Who lives where.');

    const refused = await call('people-in-city', {});
    expect(refused.error ?? refused.result?.isError).toBeTruthy();
  });

  it('marks a refused update as an error, its text the refusal messages', async () => {
    const base = await startHarness('both');
    const { call } = await connect(`${base}/mcp/people`);
    const result = await call('settle', { item: 'urn:x' });
    expect(result.result.isError).toBe(true);
    expect(result.result.content).toEqual([{ type: 'text', text: 'Refused: urn:x is not proposed.' }]);
    expect(result.result.structuredContent.statusCode).toBe(409);

    const reading = await call('people-in-city', { city: ['Perth'] });
    expect(reading.result.isError).toBeUndefined();
  });

  it('keeps a session to the endpoint that opened it', async () => {
    const base = await startHarness('both');
    const { headers } = await connect(`${base}/mcp/people`);
    const elsewhere = await post(`${base}/mcp`, { jsonrpc: '2.0', id: 9, method: 'tools/list' }, headers);
    expect(elsewhere.status).toBe(404);
  });

  it('answers 404 for a slug that publishes nothing', async () => {
    const base = await startHarness('both');
    const response = await post(`${base}/mcp/nobody`, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(response.status).toBe(404);
  });

  it('serves the catalogue alone when MCP_CATALOGUE=catalogue', async () => {
    const base = await startHarness('catalogue');
    const { tools } = await connect(`${base}/mcp`);
    expect(tools.map((tool) => tool.name)).not.toContain('people__people-in-city');
    const response = await post(`${base}/mcp/people`, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(response.status).toBe(404);
  });

  it('serves the published tools alone when MCP_CATALOGUE=published', async () => {
    const base = await startHarness('published');
    const { init, tools } = await connect(`${base}/mcp`);
    expect(tools.map((tool) => tool.name)).toEqual(['people__people-in-city', 'people__settle']);
    expect(init.result.instructions ?? '').toBe('');
  });
});
