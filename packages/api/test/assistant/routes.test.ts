import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import assistantRoutes, { configureAssistant, resetAssistantConfiguration } from '../../src/routes/assistant.js';
import type { ModelClient, ModelRequest, ModelStreamEvent } from '../../src/assistant/model.js';
import { isForbiddenForAssistant } from '../../src/assistant/allowlist.js';

/**
 * The SSE endpoint, over a real fastify instance.
 *
 * The registry underneath reaches the app with `inject`, so this app registers
 * a couple of stub routes rather than the whole API — what is under test is the
 * stream and the session bookkeeping, not the query routes, which have 1748
 * tests of their own.
 */

let scripted: ModelStreamEvent[][] = [];

/** Every request the model was handed, so a test can assert on the prompt. */
let modelRequests: ModelRequest[] = [];

function scriptedFactory() {
  let turn = 0;
  const client: ModelClient = {
    modelId: 'test/scripted',
    async *stream(request: ModelRequest) {
      modelRequests.push(request);
      const events = scripted[turn] ?? [];
      turn += 1;
      for (const event of events) yield event;
    },
  };
  return client;
}

/** The system message of the first model call, which is where a turn's context lands. */
function firstSystemPrompt(): string {
  const message = modelRequests[0]?.messages[0];
  if (message?.role !== 'system') throw new Error('expected a system message first');
  return message.content;
}

/** What the stub routes below saw, so a test can assert on what was forwarded. */
let seenAuthorization: string | undefined;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/queries', async (request) => {
    seenAuthorization = request.headers.authorization;
    return [{ id: 'urn:query:1', name: 'Existing' }];
  });
  app.post('/sparql', async () => ({ results: { bindings: [] } }));
  await app.register(assistantRoutes, { prefix: '/assistant' });
  await app.ready();
  return app;
}

/** Split an SSE body into the events it carried. */
function parseEvents(payload: string): Array<Record<string, unknown>> {
  return payload
    .split('\n\n')
    .filter((frame) => frame.includes('data: '))
    .map((frame) => JSON.parse(frame.slice(frame.indexOf('data: ') + 6)));
}

describe('assistant routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    scripted = [];
    modelRequests = [];
    seenAuthorization = undefined;
    configureAssistant({ modelClientFactory: scriptedFactory });
    app = await buildApp();
  });

  afterEach(async () => {
    resetAssistantConfiguration();
    await app.close();
  });

  async function openSession(libraryId: string | null = 'urn:lib:1') {
    const response = await app.inject({ method: 'POST', url: '/assistant/sessions', payload: { libraryId } });
    return JSON.parse(response.payload) as { id: string };
  }

  it('opens a session and reads it back', async () => {
    const { id } = await openSession();
    const response = await app.inject({ method: 'GET', url: `/assistant/sessions/${id}` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({ id, libraryId: 'urn:lib:1', running: false, drafts: [] });
  });

  it('404s an unknown session rather than opening one', async () => {
    const response = await app.inject({ method: 'GET', url: '/assistant/sessions/session-nope' });
    expect(response.statusCode).toBe(404);
  });

  it('streams tokens as server-sent events', async () => {
    scripted = [[{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }]];
    const { id } = await openSession();

    const response = await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: { prompt: 'hi', provider: 'test', model: 'scripted' },
    });

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(parseEvents(response.payload)).toEqual([
      { type: 'token', text: 'Hello ' },
      { type: 'token', text: 'there' },
      { type: 'done', reason: 'complete' },
    ]);
  });

  it('streams a changed event carrying the staged draft', async () => {
    scripted = [
      [{ type: 'tool-call', call: { id: 'c1', name: 'drafts.createQuery', arguments: { name: 'Countries', queryString: 'SELECT * WHERE { ?s ?p ?o }' } } }],
      [{ type: 'text', text: 'Staged.' }],
    ];
    const { id } = await openSession();

    const response = await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: { prompt: 'make one', provider: 'test', model: 'scripted' },
    });

    const events = parseEvents(response.payload);
    const changed = events.find((event) => event.type === 'changed') as { draft: Record<string, unknown> } | undefined;
    expect(changed?.draft).toMatchObject({ name: 'Countries', kind: 'scratch', section: 'query' });

    // And the session holds it, so a reconnecting client can catch up.
    const session = await app.inject({ method: 'GET', url: `/assistant/sessions/${id}` });
    expect(JSON.parse(session.payload).drafts).toHaveLength(1);
  });

  it('reaches the real routes through the registry', async () => {
    scripted = [
      [{ type: 'tool-call', call: { id: 'c1', name: 'queries.list', arguments: {} } }],
      [{ type: 'text', text: 'You have one.' }],
    ];
    const { id } = await openSession();

    const response = await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: { prompt: 'what do I have', provider: 'test', model: 'scripted' },
    });

    const receipt = parseEvents(response.payload).find((event) => event.type === 'receipt');
    expect(receipt).toMatchObject({ tool: 'queries.list', status: 'ok' });
  });

  /*
   * #127, end to end: the header on the SSE request has to survive the turn
   * loop and the registry and arrive at the route the tool resolves to. The
   * service-level test asserts the seam; this asserts the whole path, because
   * the seam was never the part that was missing.
   */
  it('runs a tool as the caller who asked for the turn', async () => {
    scripted = [
      [{ type: 'tool-call', call: { id: 'c1', name: 'queries.list', arguments: {} } }],
      [{ type: 'text', text: 'You have one.' }],
    ];
    const { id } = await openSession();

    await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      headers: { authorization: 'Bearer caller-token' },
      payload: { prompt: 'what do I have', provider: 'test', model: 'scripted' },
    });

    expect(seenAuthorization).toBe('Bearer caller-token');
  });

  it('sends no bearer token when the caller had none', async () => {
    scripted = [
      [{ type: 'tool-call', call: { id: 'c1', name: 'queries.list', arguments: {} } }],
      [{ type: 'text', text: 'You have one.' }],
    ];
    const { id } = await openSession();

    await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: { prompt: 'what do I have', provider: 'test', model: 'scripted' },
    });

    expect(seenAuthorization).toBeUndefined();
  });

  it('refuses a write tool — it is not in the allowlist at all', async () => {
    scripted = [
      [{ type: 'tool-call', call: { id: 'c1', name: 'queries.delete', arguments: { id: 'urn:query:1' } } }],
      [{ type: 'text', text: 'I cannot do that.' }],
    ];
    const { id } = await openSession();

    const response = await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: { prompt: 'delete it', provider: 'test', model: 'scripted' },
    });

    const receipt = parseEvents(response.payload).find((event) => event.type === 'receipt');
    // "Unknown tool" rather than "not permitted": it was never offered, so
    // there is nothing to permit.
    expect(receipt).toMatchObject({ tool: 'queries.delete', status: 'error' });
    expect(String((receipt as { error: string }).error)).toContain('Unknown tool');
  });

  it('only offers tools the assistant may call', async () => {
    const response = await app.inject({ method: 'GET', url: '/assistant/tools' });
    const payload = JSON.parse(response.payload) as { tools: Array<{ name: string; description: string | null }> };
    const tools = payload.tools.map((tool) => tool.name);

    expect(tools).toContain('queries.list');
    expect(tools).toContain('detection.detectInputs');
    // Reads of versions are fine — grounding needs them.
    expect(tools).toContain('queries.getVersion');

    // Nothing that writes, and nothing that can reach a backend with arbitrary
    // SPARQL. Asserted against the allowlist's own forbidden patterns rather
    // than a regex written here, so the contract has one definition.
    const forbidden = tools.filter((name) => isForbiddenForAssistant(name));
    expect(forbidden).toEqual([]);
    expect(tools).not.toContain('sparql.proxyQuery');
    expect(tools).not.toContain('backends.clearData');
    expect(tools).not.toContain('queries.createVersion');
  });

  it('carries a label for every tool a receipt can name', async () => {
    const response = await app.inject({ method: 'GET', url: '/assistant/tools' });
    const { tools } = JSON.parse(response.payload) as {
      tools: Array<{ name: string; title: string | null; description: string | null }>;
    };
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    /*
     * The draft tools are added by the turn loop rather than the registry, and
     * they are the ones receipts name most, so a list that omits them would
     * leave the chat showing `drafts.createQuery` and nothing else.
     */
    for (const name of ['drafts.createQuery', 'drafts.updateQuery', 'drafts.runQuery']) {
      expect(byName.has(name)).toBe(true);
    }

    // A title where the description is written for a model rather than a header.
    expect(byName.get('drafts.createQuery')?.title).toBe('Stage a query draft');
    expect(byName.get('drafts.runQuery')?.title).toBe('Run a draft');

    // And none where the description is already label-length — one wording, not two.
    expect(byName.get('queries.list')?.title).toBeNull();
    expect(byName.get('queries.list')?.description).toBe('List queries');

    // Every tool resolves to something readable by one route or the other.
    expect(tools.every((tool) => Boolean(tool.title ?? tool.description))).toBe(true);
  });

  it('keeps the model-facing description even where a title exists', async () => {
    const response = await app.inject({ method: 'GET', url: '/assistant/tools' });
    const { tools } = JSON.parse(response.payload) as {
      tools: Array<{ name: string; title: string | null; description: string | null }>;
    };

    /*
     * The title is a display label, not a replacement. Shortening what the
     * model reads would change tool selection, which is the one thing this
     * change must not do.
     */
    const created = tools.find((tool) => tool.name === 'drafts.createQuery');
    expect(created?.description).toContain('never saved to the server until the user presses Save');
  });

  it('tells the model what the sender has on screen', async () => {
    scripted = [[{ type: 'text', text: 'ok' }]];
    const { id } = await openSession();

    await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: {
        prompt: 'why does it fail?',
        provider: 'test',
        model: 'scripted',
        context: {
          screen: 'build',
          openEntity: { id: 'urn:query:1', type: 'query', name: 'Existing' },
          lastError: 'Backend refused: 400',
        },
      },
    });

    const prompt = firstSystemPrompt();
    expect(prompt).toContain('Open: query urn:query:1 named "Existing"');
    expect(prompt).toContain('Backend refused: 400');
  });

  it('runs the turn anyway when the context is malformed', async () => {
    scripted = [[{ type: 'text', text: 'ok' }]];
    const { id } = await openSession();

    const response = await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: { prompt: 'hi', provider: 'test', model: 'scripted', context: 'the build screen' },
    });

    // A context we cannot read is a context we do not send — never a turn the
    // user loses.
    expect(parseEvents(response.payload)).toEqual([
      { type: 'token', text: 'ok' },
      { type: 'done', reason: 'complete' },
    ]);
    expect(firstSystemPrompt()).not.toContain("on the user's screen");
  });

  it('needs a prompt and a provider', async () => {
    const { id } = await openSession();

    const noPrompt = await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: { provider: 'test', model: 'scripted' },
    });
    expect(noPrompt.statusCode).toBe(400);

    const noProvider = await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: { prompt: 'hi' },
    });
    expect(noProvider.statusCode).toBe(400);
  });

  it('says plainly when no provider is configured, rather than failing deeper', async () => {
    resetAssistantConfiguration();
    const { id } = await openSession();

    const response = await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      payload: { prompt: 'hi', provider: 'anthropic', model: 'claude-opus-5' },
    });

    // The unconfigured client throws on first use, which surfaces as a done
    // event on the stream rather than a hung request.
    const events = parseEvents(response.payload);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'error' });
    expect(String((events.at(-1) as { message: string }).message)).toContain('No model client is configured');
  });

  it('interrupts a session that is not running without pretending it did', async () => {
    const { id } = await openSession();
    const response = await app.inject({ method: 'POST', url: `/assistant/sessions/${id}/interrupt` });
    expect(JSON.parse(response.payload)).toEqual({ interrupted: false });
  });
});

/**
 * A turn survives its own request being read.
 *
 * Over a real socket a node `IncomingMessage` emits `close` as soon as the
 * request stream completes — for a POST, once the body is read, which is long
 * before the client goes anywhere. Interrupting the turn on that killed every
 * turn on its first step, and an aborted stream yields no events, so the loop
 * saw no tool calls and reported `complete`: the turn ended silently instead of
 * failing. `inject` does not drive that lifecycle, which is why the tests above
 * never saw it, so this one listens on a real port.
 */
describe('assistant SSE lifecycle', () => {
  let app: FastifyInstance;
  let origin: string;

  /** Respects `signal` the way a real provider client does, so an abort shows up as silence. */
  function abortAwareFactory() {
    const client: ModelClient = {
      modelId: 'test/abort-aware',
      async *stream({ signal }) {
        await new Promise((resolve) => setImmediate(resolve));
        if (signal?.aborted) return;
        yield { type: 'text', text: 'hello' } as ModelStreamEvent;
      },
    };
    return client;
  }

  beforeEach(async () => {
    configureAssistant({ modelClientFactory: abortAwareFactory });
    app = Fastify({ logger: false });
    await app.register(assistantRoutes, { prefix: '/assistant' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    resetAssistantConfiguration();
    await app.close();
  });

  it('streams the turn instead of interrupting itself when the body is read', async () => {
    const opened = await fetch(`${origin}/assistant/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { id } = (await opened.json()) as { id: string };

    const response = await fetch(`${origin}/assistant/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi', provider: 'test', model: 'scripted' }),
    });
    const events = parseEvents(await response.text());

    // The bug produced exactly one frame — a `complete` that had streamed nothing.
    expect(events).toEqual([
      { type: 'token', text: 'hello' },
      { type: 'done', reason: 'complete' },
    ]);
  });
});

/**
 * The stream carries the plugin's headers, not just its own.
 *
 * `reply.raw.writeHead` bypasses the reply lifecycle, and with it every header
 * a plugin staged through `reply.header()`. CORS headers only reach the socket
 * when `reply.send()` flushes them, and a hand-streamed SSE response never
 * calls `send` — so the turn came back 200 with no `Access-Control-Allow-Origin`
 * and the browser dropped it. The app above registers no plugins, which is why
 * nothing here caught that; this block registers cors the way the real server
 * does.
 */
describe('assistant SSE headers', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    scripted = [[{ type: 'text', text: 'hi' }]];
    configureAssistant({ modelClientFactory: scriptedFactory });
    app = Fastify({ logger: false });
    // Mirrors the registration in src/index.ts.
    await app.register(fastifyCors, { origin: '*', credentials: true });
    await app.register(assistantRoutes, { prefix: '/assistant' });
    await app.ready();
  });

  afterEach(async () => {
    resetAssistantConfiguration();
    await app.close();
  });

  it('keeps the staged CORS headers on the streamed response', async () => {
    const opened = await app.inject({ method: 'POST', url: '/assistant/sessions', payload: {} });
    const { id } = JSON.parse(opened.payload) as { id: string };

    const response = await app.inject({
      method: 'POST',
      url: `/assistant/sessions/${id}/messages`,
      headers: { origin: 'http://localhost:3001' },
      payload: { prompt: 'hi', provider: 'test', model: 'scripted' },
    });

    expect(response.statusCode).toBe(200);
    // Without this the browser discards a 200 it already received.
    expect(response.headers['access-control-allow-origin']).toBe('*');
    // The stream's own headers still win over the staged ones, so a spread that
    // lands the wrong way round fails here rather than silently serving JSON.
    expect(response.headers['content-type']).toContain('text/event-stream');
  });
});
