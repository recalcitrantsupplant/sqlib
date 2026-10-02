import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { isInitializeRequest, type Server } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createMcpServer, type CreateMcpServerOptions } from './index.js';

export type StreamableHttpServerOptions = {
  host?: string;
  port?: number;
  fastifyInstance?: FastifyInstance;
  mcpOptions?: CreateMcpServerOptions;
  bootstrapApiApp?: boolean;
  /**
   * Browser origins allowed to call `/mcp`. Defaults to `SQLIB_CORS_ORIGINS`
   * (see resolveCorsPolicy).
   */
  corsPolicy?: CorsPolicy;
  /**
   * How long a transport created for an `initialize` request may go without
   * completing it before it is closed. Default 30s.
   */
  initTimeoutMs?: number;
};

export type McpHttpSession = {
  id?: string;
  /** sha256 of the creating caller's identity; see callerKey. */
  owner: string;
  server: Server;
  transport: NodeStreamableHTTPServerTransport;
  shutdown: () => Promise<void>;
  closed: boolean;
  initTimer?: ReturnType<typeof setTimeout>;
};

/**
 * Which browser origins may read `/mcp` responses.
 *
 * `any` is the literal `*`: every origin, never with credentials. `origins` is
 * an explicit list, and only a listed origin is echoed back with
 * `access-control-allow-credentials: true`.
 */
export type CorsPolicy = { any: boolean; origins: ReadonlySet<string> };

/** The SPA's dev server (`packages/web/nuxt.config.ts`, `devServer.port`). */
const DEV_CORS_ORIGINS = ['http://localhost:3001', 'http://127.0.0.1:3001'];

const normaliseOrigin = (origin: string) => origin.trim().replace(/\/+$/, '');

/**
 * `SQLIB_CORS_ORIGINS`: a comma-separated origin list, or `*`. Unset, it is the
 * SPA dev origins under `NODE_ENV=development` and nothing otherwise; set to
 * the empty string, it is nothing.
 */
export function resolveCorsPolicy(env: NodeJS.ProcessEnv = process.env): CorsPolicy {
  const raw = env.SQLIB_CORS_ORIGINS;
  const entries =
    raw === undefined
      ? env.NODE_ENV === 'development'
        ? DEV_CORS_ORIGINS
        : []
      : raw.split(',').map(normaliseOrigin).filter(Boolean);
  const any = entries.includes('*');
  return { any, origins: new Set(entries.filter((entry) => entry !== '*')) };
}

const MCP_EXPOSED_HEADERS = 'ETag, Last-Modified, Server-Timing, mcp-session-id';
const MCP_ALLOWED_HEADERS =
  'Accept, Authorization, Content-Type, Last-Event-ID, mcp-protocol-version, mcp-session-id';
const MCP_ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS';

const sha256 = (text: string) => createHash('sha256').update(text).digest();

/**
 * Who is calling, as a digest stored on the session it creates.
 *
 * Under an enforcing auth mode the API's auth plugin has already verified the
 * token and set `request.authContext`, so the session binds to the token's
 * issuer and subject and survives a token refresh. Otherwise it binds to the
 * raw `Authorization` header (absent counts as one caller: the anonymous one).
 */
function callerKey(request: FastifyRequest): Buffer {
  const context = (request as { authContext?: { fullAccess?: boolean; issuer?: string; subject?: string } })
    .authContext;
  if (context && context.fullAccess === false && context.subject) {
    return sha256(`subject\n${context.issuer ?? ''}\n${context.subject}`);
  }
  const header = request.headers.authorization;
  return sha256(`authorization\n${header ?? ''}`);
}

const ownsSession = (session: McpHttpSession, request: FastifyRequest) => {
  const caller = callerKey(request);
  const owner = Buffer.from(session.owner, 'hex');
  return owner.length === caller.length && timingSafeEqual(owner, caller);
};

/** A body is an initialize if it is one, or a batch holding one. */
const isInitializeBody = (body: unknown) =>
  Array.isArray(body) ? body.some((message) => isInitializeRequest(message)) : isInitializeRequest(body);

const jsonRpcError = (code: number, message: string) => ({
  jsonrpc: '2.0',
  error: { code, message },
  id: null,
});

/**
 * Register the MCP streamable-HTTP routes on a Fastify instance without
 * listening. `startStreamableHttpMcpServer` is this plus `listen`.
 */
export async function buildStreamableHttpMcpServer(options: StreamableHttpServerOptions = {}) {
  const app = options.fastifyInstance ?? Fastify({ logger: true });
  const shouldBootstrapApiApp = options.bootstrapApiApp ?? true;
  const corsPolicy = options.corsPolicy ?? resolveCorsPolicy();
  const initTimeoutMs = options.initTimeoutMs ?? 30_000;
  let apiTeardown: (() => Promise<void>) | undefined;

  if (shouldBootstrapApiApp) {
    const { shutdown } = await createMcpServer({
      ...options.mcpOptions,
      fastifyInstance: app,
      skipAppSetup: false,
    });
    apiTeardown = shutdown;
  }
  const sessions = new Map<string, McpHttpSession>();

  /** Returns the origin to echo, `*`, or undefined when the origin is not allowed. */
  const allowedOrigin = (request: FastifyRequest): string | undefined => {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    if (!origin) return undefined;
    if (corsPolicy.origins.has(normaliseOrigin(origin))) return origin;
    return corsPolicy.any ? '*' : undefined;
  };

  const applyMcpCorsHeaders = (request: FastifyRequest, reply: FastifyReply) => {
    const origin = allowedOrigin(request);
    if (corsPolicy.origins.size > 0) {
      const vary = reply.raw.getHeader('vary');
      const varyText = Array.isArray(vary) ? vary.join(', ') : typeof vary === 'string' ? vary : '';
      if (!/\borigin\b/i.test(varyText)) {
        reply.raw.setHeader('vary', varyText ? `${varyText}, Origin` : 'Origin');
      }
    }
    if (!origin) return false;
    reply.raw.setHeader('access-control-allow-origin', origin);
    if (origin !== '*') reply.raw.setHeader('access-control-allow-credentials', 'true');
    reply.raw.setHeader('access-control-expose-headers', MCP_EXPOSED_HEADERS);
    return true;
  };

  const cleanupSession = async (session: McpHttpSession) => {
    if (session.closed) return;
    session.closed = true;
    if (session.initTimer) clearTimeout(session.initTimer);
    const sid = session.id ?? session.transport.sessionId;
    if (sid) sessions.delete(sid);
    try {
      await session.shutdown();
    } catch (err) {
      app.log.error({ err, sessionId: sid }, 'Failed to shut down MCP session');
    }
  };

  /** Close the transport (which fires onclose → cleanupSession) and make sure cleanup ran. */
  const disposeSession = async (session: McpHttpSession) => {
    if (session.closed) return;
    try {
      await session.transport.close();
    } catch (err) {
      app.log.error({ err }, 'Failed to close MCP transport');
    }
    await cleanupSession(session);
  };

  const createSession = async (owner: Buffer) => {
    const { server, shutdown } = await createMcpServer({
      ...options.mcpOptions,
      fastifyInstance: app,
      skipAppSetup: true,
    });
    const session: McpHttpSession = {
      owner: owner.toString('hex'),
      server,
      transport: null as unknown as NodeStreamableHTTPServerTransport,
      shutdown,
      closed: false,
    };

    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        if (session.closed) return;
        session.id = newSessionId;
        if (session.initTimer) clearTimeout(session.initTimer);
        session.initTimer = undefined;
        sessions.set(newSessionId, session);
      },
    });

    session.transport = transport;

    transport.onclose = () => {
      void cleanupSession(session);
    };

    // Backstop for a transport whose initialize never completes (a client
    // that hangs up mid-request, say): it is not in `sessions`, so nothing
    // else would ever close it.
    session.initTimer = setTimeout(() => {
      if (!session.id) void disposeSession(session);
    }, initTimeoutMs);
    session.initTimer.unref?.();

    await server.connect(transport);

    return session;
  };

  /**
   * Look up the session a request names. Replies (and returns undefined) when
   * there is none: 400 without a header, 404 for an unknown id — the MCP
   * streamable-HTTP answer that tells a client to re-initialise — and 403 when
   * the session belongs to another caller.
   */
  const resolveSession = (request: FastifyRequest, reply: FastifyReply): McpHttpSession | undefined => {
    const sessionId = request.headers['mcp-session-id'];
    if (typeof sessionId !== 'string' || !sessionId) {
      reply.code(400).send(jsonRpcError(-32000, 'Bad Request: missing mcp-session-id'));
      return undefined;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      reply.code(404).send(jsonRpcError(-32001, 'Session not found'));
      return undefined;
    }
    if (!ownsSession(session, request)) {
      reply.code(403).send(jsonRpcError(-32003, 'Forbidden: session belongs to another caller'));
      return undefined;
    }
    return session;
  };

  // Encapsulated so the catch-all content-type parser applies to /mcp only.
  // Registered on the shared instance, it would turn every REST route's 415
  // for an unsupported media type into a Buffer body in `dual-http` mode.
  await app.register(async (mcp) => {
    mcp.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    mcp.options('/mcp', async (request, reply) => {
      if (applyMcpCorsHeaders(request, reply)) {
        reply.header('access-control-allow-methods', MCP_ALLOWED_METHODS);
        reply.header('access-control-allow-headers', MCP_ALLOWED_HEADERS);
        reply.header('access-control-max-age', '600');
      }
      reply.code(204).send();
    });

    mcp.post('/mcp', async (request, reply) => {
      applyMcpCorsHeaders(request, reply);

      if (request.headers['mcp-session-id'] !== undefined) {
        const session = resolveSession(request, reply);
        if (!session) return;
        reply.hijack();
        await session.transport.handleRequest(request.raw, reply.raw, request.body as any);
        return;
      }

      // No session yet: only an initialize may create one, and nothing is
      // allocated for anything else.
      if (!isInitializeBody(request.body)) {
        reply.code(400).send(jsonRpcError(-32000, 'Bad Request: no valid session ID provided'));
        return;
      }

      const session = await createSession(callerKey(request));
      reply.hijack();
      try {
        await session.transport.handleRequest(request.raw, reply.raw, request.body as any);
      } finally {
        // The transport refused the initialize (bad Accept header, invalid
        // params, ...): it never registered, so close it here.
        if (!session.id) await disposeSession(session);
      }
    });

    mcp.get('/mcp', async (request, reply) => {
      applyMcpCorsHeaders(request, reply);
      const session = resolveSession(request, reply);
      if (!session) return;
      reply.hijack();
      await session.transport.handleRequest(request.raw, reply.raw);
    });

    mcp.delete('/mcp', async (request, reply) => {
      applyMcpCorsHeaders(request, reply);
      const session = resolveSession(request, reply);
      if (!session) return;
      await disposeSession(session);
      reply.code(204).send();
    });
  });

  const shutdown = async () => {
    const activeSessions = Array.from(sessions.values());
    for (const session of activeSessions) {
      await disposeSession(session);
    }

    sessions.clear();
    if (apiTeardown) {
      await apiTeardown();
      return;
    }
    await app.close();
  };

  return { app, shutdown, sessions: sessions as ReadonlyMap<string, McpHttpSession> };
}

export async function startStreamableHttpMcpServer(options: StreamableHttpServerOptions = {}) {
  const { app, shutdown, sessions } = await buildStreamableHttpMcpServer(options);

  const port = options.port ?? (process.env.MCP_HTTP_PORT ? Number(process.env.MCP_HTTP_PORT) : 3333);
  const host = options.host ?? process.env.MCP_HTTP_HOST ?? '0.0.0.0';

  await app.listen({ port, host });
  const address = app.server.address() as AddressInfo | null;
  const boundPort = address?.port ?? port;

  console.log(`MCP HTTP server running at http://${host}:${boundPort}/mcp`);

  return { app, shutdown, sessions, host, port: boundPort };
}

const isDirectRun = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;

if (isDirectRun) {
  startStreamableHttpMcpServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start MCP HTTP server', err);
    process.exit(1);
  });
}
