/**
 * The response header that decides whether a browser may answer from its own
 * copy.
 *
 * This is not a style rule about headers. An entity read carries `ETag` and
 * `Last-Modified` for `If-Match`, and with no `Cache-Control` beside them a
 * cache is allowed to invent a freshness lifetime (RFC 9111 §4.2.2) — Chromium
 * uses a tenth of the age of `Last-Modified`. That is what made saving a new
 * version look like it had not become current: the POST set it on the server,
 * and the reload that followed read the query out of the browser cache, still
 * naming the previous version.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerNoStoreHook } from '../../src/lib/httpCaching.js';

async function appWithHook() {
  const app = Fastify({ logger: false });
  registerNoStoreHook(app);

  app.get('/entity', async (_request, reply) => {
    // An entity read as the real routes send one: validators, no directive.
    reply.header('ETag', '"2026-09-07T13:52:06.061Z"');
    reply.header('Last-Modified', 'Mon, 07 Sep 2026 13:52:06 GMT');
    return reply.send({ currentVersion: 'urn:sqlib:query-version:2' });
  });

  app.get('/stream', async (_request, reply) => {
    reply.header('Cache-Control', 'no-cache, no-transform');
    return reply.send('data: hello\n\n');
  });

  app.post('/writes', async (_request, reply) => reply.status(201).send({ ok: true }));

  await app.ready();
  return app;
}

describe('no-store hook', () => {
  it('gives a validator-carrying entity read a cache directive of its own', async () => {
    const app = await appWithHook();
    const response = await app.inject({ method: 'GET', url: '/entity' });

    expect(response.headers['cache-control']).toBe('no-store');
    // The validators are for `If-Match`, and stay.
    expect(response.headers.etag).toBe('"2026-09-07T13:52:06.061Z"');
    expect(response.headers['last-modified']).toBe('Mon, 07 Sep 2026 13:52:06 GMT');

    await app.close();
  });

  it('leaves a route that set its own directive alone', async () => {
    const app = await appWithHook();
    const response = await app.inject({ method: 'GET', url: '/stream' });

    expect(response.headers['cache-control']).toBe('no-cache, no-transform');

    await app.close();
  });

  it('covers writes too, so a 201 is never stored against its URL', async () => {
    const app = await appWithHook();
    const response = await app.inject({ method: 'POST', url: '/writes' });

    expect(response.headers['cache-control']).toBe('no-store');

    await app.close();
  });
});
