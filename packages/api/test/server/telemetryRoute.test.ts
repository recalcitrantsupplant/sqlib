import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { trace } from '@opentelemetry/api';
import { registerTelemetryRoute } from '../../src/server/metrics.js';
import { registerTraceLinkHook, TRACE_URL_HEADER } from '../../src/server/traceLink.js';
import { TELEMETRY_HANDLE_KEY, resetTelemetryStatus } from '../../src/lib/telemetryStatus.js';
import type { AuthContext } from '../../src/auth/types.js';

const slot = globalThis as Record<symbol, unknown>;

const contextWith = (admin: boolean): AuthContext => ({
  subject: 'urn:sqlib:principal:user:someone',
  principals: ['urn:sqlib:principal:user:someone'],
  issuer: 'https://issuer.test/',
  tokenType: 'user',
  grants: { admin, libraries: new Map(), backends: new Map() },
  claims: {},
  fullAccess: false,
  mode: 'required',
});

async function appAs(auth: AuthContext | undefined): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    reply.status((error as { statusCode?: number }).statusCode ?? 500).send({ error: error.message });
  });
  app.decorateRequest('authContext', undefined);
  app.addHook('onRequest', async (request) => {
    request.authContext = auth;
  });
  registerTelemetryRoute(app);
  await app.ready();
  return app;
}

describe('GET /telemetry', () => {
  beforeEach(() => resetTelemetryStatus());

  it('refuses a non-administrator', async () => {
    const app = await appAs(contextWith(false));
    const res = await app.inject({ method: 'GET', url: '/telemetry' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('answers an administrator with the status', async () => {
    const app = await appAs(contextWith(true));
    const res = await app.inject({ method: 'GET', url: '/telemetry' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'off', slowRuns: { count: 0 }, traceLinks: false });
    await app.close();
  });
});

describe('trace link header', () => {
  const originalTemplate = process.env.SQLIB_TRACE_URL_TEMPLATE;
  const traceId = '0af7651916cd43dd8448eb211c80319c';

  afterEach(() => {
    vi.restoreAllMocks();
    delete slot[TELEMETRY_HANDLE_KEY];
    if (originalTemplate === undefined) delete process.env.SQLIB_TRACE_URL_TEMPLATE;
    else process.env.SQLIB_TRACE_URL_TEMPLATE = originalTemplate;
  });

  async function appWithSpan(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    // Stands in for the instrumentation, which runs the request inside its span.
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(
      trace.wrapSpanContext({ traceId, spanId: 'b7ad6b7169203331', traceFlags: 1 }),
    );
    registerTraceLinkHook(app);
    app.get('/x', async () => ({ ok: true }));
    await app.ready();
    return app;
  }

  it('is not added when telemetry is off', async () => {
    process.env.SQLIB_TRACE_URL_TEMPLATE = 'https://t.example/{traceId}';
    const app = await appWithSpan();
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.headers[TRACE_URL_HEADER.toLowerCase()]).toBeUndefined();
    await app.close();
  });

  it('links the request trace when telemetry runs and a template is set', async () => {
    process.env.SQLIB_TRACE_URL_TEMPLATE = 'https://t.example/{traceId}';
    slot[TELEMETRY_HANDLE_KEY] = {};
    const app = await appWithSpan();
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.headers[TRACE_URL_HEADER.toLowerCase()]).toBe(`https://t.example/${traceId}`);
    await app.close();
  });
});
