import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

type Session = {
  server: Server;
  transport: StreamableHTTPServerTransport;
};

function createMcpServer(): Server {
  const server = new Server(
    { name: 'debug-echo-mcp', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'echo',
        description: 'Echo back whatever input was sent (for debugging)',
        inputSchema: {
          type: 'object' as const,
          properties: {
            message: { type: 'string', description: 'Message to echo' },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'echo') {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(request.params.arguments, null, 2),
          },
        ],
      };
    }
    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  return server;
}

async function main() {
  const sessions = new Map<string, Session>();

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname !== '/mcp') {
      res.writeHead(404).end('Not Found');
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (req.method === 'POST') {
      let session = sessionId ? sessions.get(sessionId) : undefined;

      if (!session) {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            sessions.set(newSessionId, session!);
          },
        });

        session = { server, transport };
        await server.connect(transport);
      }

      // Read body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const bodyStr = Buffer.concat(chunks).toString();

      // eslint-disable-next-line no-console
      console.error('debug-echo raw body:', bodyStr);

      // Parse body as JSON - the transport expects a parsed object
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(bodyStr);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      await session.transport.handleRequest(req, res, parsedBody);
    } else if (req.method === 'GET') {
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
        return;
      }
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
    } else if (req.method === 'DELETE') {
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.close();
        sessions.delete(sessionId);
      }
      res.writeHead(204).end();
    } else {
      res.writeHead(405).end('Method Not Allowed');
    }
  });

  const port = process.env.MCP_DEBUG_PORT ? Number(process.env.MCP_DEBUG_PORT) : 3334;
  const host = process.env.MCP_DEBUG_HOST ?? '127.0.0.1';

  httpServer.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`Debug MCP server (streamable HTTP) at http://${host}:${port}/mcp`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start debug MCP server', err);
  process.exit(1);
});
