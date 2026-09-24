import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Server } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createMcpServer, type CreateMcpServerOptions } from './index.js';

export type StreamableHttpServerOptions = {
  host?: string;
  port?: number;
  fastifyInstance?: FastifyInstance;
  mcpOptions?: CreateMcpServerOptions;
  bootstrapApiApp?: boolean;
};

type Session = {
  id?: string;
  server: Server;
  transport: NodeStreamableHTTPServerTransport;
  shutdown: () => Promise<void>;
  closed: boolean;
};

export async function startStreamableHttpMcpServer(options: StreamableHttpServerOptions = {}) {
  const app = options.fastifyInstance ?? Fastify({ logger: true });
  const shouldBootstrapApiApp = options.bootstrapApiApp ?? true;
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  let apiTeardown: (() => Promise<void>) | undefined;

  if (shouldBootstrapApiApp) {
    const { shutdown } = await createMcpServer({
      ...options.mcpOptions,
      fastifyInstance: app,
      skipAppSetup: false,
    });
    apiTeardown = shutdown;
  }
  const sessions = new Map<string, Session>();
  const mcpExposedHeaders = 'ETag, Last-Modified, Server-Timing, mcp-session-id';

  const applyMcpCorsHeaders = (request: { headers: Record<string, unknown> }, reply: { raw: import('node:http').ServerResponse }) => {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    reply.raw.setHeader('access-control-allow-origin', origin ?? '*');
    reply.raw.setHeader('access-control-allow-credentials', 'true');
    reply.raw.setHeader('access-control-expose-headers', mcpExposedHeaders);
    if (origin) {
      const vary = reply.raw.getHeader('vary');
      const varyText = Array.isArray(vary) ? vary.join(', ') : typeof vary === 'string' ? vary : '';
      reply.raw.setHeader('vary', varyText ? `${varyText}, Origin` : 'Origin');
    }
  };

  const cleanupSession = async (session: Session) => {
    if (session.closed) return;
    session.closed = true;
    const sid = session.id ?? (session.transport as any).sessionId;
    if (sid) sessions.delete(sid);
    try {
      await session.shutdown();
    } catch (err) {
      app.log.error({ err, sessionId: sid }, 'Failed to shut down MCP session');
    }
  };

  const createSession = async () => {
    const { server, shutdown } = await createMcpServer({
      ...options.mcpOptions,
      fastifyInstance: app,
      skipAppSetup: true,
    });
    const session: Session = {
      server,
      transport: null as unknown as NodeStreamableHTTPServerTransport,
      shutdown,
      closed: false,
    };

    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        session.id = newSessionId;
        sessions.set(newSessionId, session);
      },
    });

    session.transport = transport;

    transport.onclose = () => {
      void cleanupSession(session);
    };

    await server.connect(transport);

    return session;
  };

  /*
   * The preflight, without which no browser reaches `/mcp` cross-origin.
   *
   * The response headers were already set on every real request, but a POST
   * carrying `content-type: application/json` and `mcp-session-id` is not a
   * simple request: the browser asks first, fastify had no OPTIONS route, and
   * the 404 that came back failed the call before it was made. The Connect
   * page's own check is the first caller to notice, and any browser-hosted MCP
   * client would be the second.
   */
  app.options('/mcp', async (request, reply) => {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    reply
      .header('access-control-allow-origin', origin ?? '*')
      .header('access-control-allow-credentials', 'true')
      .header('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
      .header(
        'access-control-allow-headers',
        request.headers['access-control-request-headers'] ??
          'content-type, accept, authorization, mcp-session-id, mcp-protocol-version'
      )
      .header('access-control-expose-headers', mcpExposedHeaders)
      .header('access-control-max-age', '86400')
      .header('vary', 'Origin')
      .code(204)
      .send();
  });

  app.post('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    const session = sessionId && sessions.has(sessionId) ? sessions.get(sessionId)! : await createSession();

    applyMcpCorsHeaders(request, reply);
    reply.hijack();
    await session.transport.handleRequest(request.raw, reply.raw, request.body as any);
  });

  app.get('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      reply.code(400).send({ error: 'Invalid or missing session ID' });
      return;
    }

    const session = sessions.get(sessionId)!;
    applyMcpCorsHeaders(request, reply);
    reply.hijack();
    await session.transport.handleRequest(request.raw, reply.raw);
  });

  app.delete('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.close();
      await cleanupSession(session);
    }

    reply.code(204).send();
  });

  const port = options.port ?? (process.env.MCP_HTTP_PORT ? Number(process.env.MCP_HTTP_PORT) : 3333);
  const host = options.host ?? process.env.MCP_HTTP_HOST ?? '0.0.0.0';

  await app.listen({ port, host });

  console.log(`MCP HTTP server running at http://${host}:${port}/mcp`);

  const shutdown = async () => {
    const activeSessions = Array.from(sessions.values());
    for (const session of activeSessions) {
      try {
        await session.transport.close();
      } catch (err) {
        app.log.error({ err }, 'Failed to close MCP transport');
      }
      await cleanupSession(session);
    }

    sessions.clear();
    if (apiTeardown) {
      await apiTeardown();
      return;
    }
    await app.close();
  };

  return { app, shutdown, host, port };
}

const isDirectRun = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;

if (isDirectRun) {
  startStreamableHttpMcpServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start MCP HTTP server', err);
    process.exit(1);
  });
}
