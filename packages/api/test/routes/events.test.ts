/**
 * The change feed, end to end over a real Fastify instance.
 *
 * The stub routes stand in for the query routes for the same reason the
 * assistant route tests do it: what is under test is the hook, the filtering
 * and the stream, not entity persistence.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import eventRoutes from '../../src/routes/events.js';
import {
  changeEventFor,
  changeSubscriberCount,
  describeRoute,
  registerChangeFeedHook,
  resetChangeSubscribers,
  subscribeChanges,
  type ChangeEvent,
} from '../../src/lib/changeEvents.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerChangeFeedHook(app);
  await app.register(eventRoutes, { prefix: '/events' });

  app.post('/queries', async (_request, reply) =>
    reply.status(201).send({ id: 'urn:query:new', libraryId: 'urn:library:1' })
  );
  app.put('/queries/:id', async (request) => ({
    id: (request.params as { id: string }).id,
    libraryId: 'urn:library:1',
  }));
  app.delete('/queries/:id', async (_request, reply) => reply.status(204).send());
  app.put('/queries/:id/fails', async (_request, reply) =>
    reply.status(409).send({ error: 'conflict' })
  );
  app.get('/queries', async () => []);
  app.post('/execute', async () => ({ results: { bindings: [] } }));

  await app.ready();
  return app;
}

/** Collect the frames the hook publishes while `run` executes. */
async function capture(run: () => Promise<unknown>): Promise<ChangeEvent[]> {
  const events: ChangeEvent[] = [];
  const unsubscribe = subscribeChanges((event) => events.push(event));
  try {
    await run();
  } finally {
    unsubscribe();
  }
  return events;
}

describe('change feed hook', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetChangeSubscribers();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    resetChangeSubscribers();
  });

  it('announces a create with the id from the response body', async () => {
    const events = await capture(() =>
      app.inject({ method: 'POST', url: '/queries', payload: { name: 'A' } })
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'changed',
      entity: 'query',
      id: 'urn:query:new',
      libraryId: 'urn:library:1',
      method: 'POST',
    });
  });

  it('announces an update with the id from the url, decoded', async () => {
    const events = await capture(() =>
      app.inject({
        method: 'PUT',
        url: `/queries/${encodeURIComponent('urn:query:1')}`,
        payload: { name: 'B' },
      })
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entity: 'query', id: 'urn:query:1', method: 'PUT' });
  });

  it('announces a delete, which has no body at all', async () => {
    const events = await capture(() =>
      app.inject({ method: 'DELETE', url: '/queries/urn:query:1' })
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entity: 'query', method: 'DELETE' });
  });

  it('carries the writer id so a tab can skip its own echo', async () => {
    const events = await capture(() =>
      app.inject({
        method: 'PUT',
        url: '/queries/urn:query:1',
        headers: { 'x-sqlib-client-id': 'tab-7' },
        payload: { name: 'B' },
      })
    );

    expect(events[0]?.origin).toBe('tab-7');
  });

  it('stays quiet for reads, failures and non-entity routes', async () => {
    const events = await capture(async () => {
      await app.inject({ method: 'GET', url: '/queries' });
      await app.inject({ method: 'PUT', url: '/queries/urn:query:1/fails', payload: {} });
      await app.inject({ method: 'POST', url: '/execute', payload: {} });
    });

    expect(events).toEqual([]);
  });
});

describe('describeRoute', () => {
  it('finds the collection behind a base path', () => {
    expect(describeRoute('/api/v1/queries/urn:query:1')).toEqual({
      entity: 'query',
      id: 'urn:query:1',
    });
  });

  it('ignores the trailing segments of a nested write', () => {
    expect(describeRoute('/queries/urn:query:1/v/2?expand=true')).toEqual({
      entity: 'query',
      id: 'urn:query:1',
    });
  });

  it('returns null for routes that are not entity collections', () => {
    expect(describeRoute('/execute')).toBeNull();
    expect(describeRoute('/assistant/sessions/abc/messages')).toBeNull();
  });
});

describe('changeEventFor', () => {
  const reply = { statusCode: 200 } as never;

  it('treats a library write as its own library id', () => {
    const request = {
      method: 'PUT',
      url: '/libraries/urn:library:9',
      headers: {},
      body: {},
      query: {},
    } as never;

    expect(changeEventFor(request, reply, '')).toMatchObject({
      entity: 'library',
      id: 'urn:library:9',
      libraryId: 'urn:library:9',
    });
  });

  it('falls back to the request body for the library', () => {
    const request = {
      method: 'POST',
      url: '/query-groups',
      headers: {},
      body: { libraryId: 'urn:library:2' },
      query: {},
    } as never;

    expect(changeEventFor(request, reply, 'not json')).toMatchObject({
      entity: 'queryGroup',
      libraryId: 'urn:library:2',
    });
  });
});

describe('GET /events', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetChangeSubscribers();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    resetChangeSubscribers();
  });

  it('streams a change to a subscriber, and greets it on connect', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();

    const response = await fetch(`${address}/events`, { signal: controller.signal });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBe('no');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const greeting = decoder.decode((await reader.read()).value);
    expect(greeting).toContain(': connected');

    await app.inject({ method: 'PUT', url: '/queries/urn:query:1', payload: { name: 'B' } });

    const frame = decoder.decode((await reader.read()).value);
    const event = JSON.parse(frame.slice(frame.indexOf('data: ') + 6));
    expect(event).toMatchObject({ type: 'changed', entity: 'query', id: 'urn:query:1' });

    controller.abort();
    await reader.cancel().catch(() => undefined);
  });

  it('keeps the staged CORS headers on the streamed response', async () => {
    // A separate instance: the shared one has no CORS plugin, and what is under
    // test is precisely that the plugin's staged headers survive `writeHead`.
    const cors = Fastify({ logger: false });
    // Mirrors the registration in src/index.ts.
    await cors.register(fastifyCors, { origin: '*', credentials: true });
    await cors.register(eventRoutes, { prefix: '/events' });
    const address = await cors.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();

    try {
      const response = await fetch(`${address}/events`, {
        headers: { origin: 'http://localhost:3001' },
        signal: controller.signal,
      });

      expect(response.status).toBe(200);
      // Without this the browser discards a 200 it already received, and the
      // view goes back to being as stale as it was before the feed existed.
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      // The stream's own headers still win over the staged ones.
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      controller.abort();
      await response.body!.cancel().catch(() => undefined);
    } finally {
      controller.abort();
      await cors.close();
    }
  });

  it('unsubscribes when the client goes away', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();

    const response = await fetch(`${address}/events`, { signal: controller.signal });
    await response.body!.getReader().read();
    expect(changeSubscriberCount()).toBe(1);

    controller.abort();

    await expect
      .poll(() => changeSubscriberCount(), { timeout: 2000 })
      .toBe(0);
  });
});
