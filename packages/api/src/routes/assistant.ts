/**
 * The in-app assistant's endpoints — door A.
 *
 * `POST /assistant/sessions/:id/messages` is the only interesting one: it
 * returns Server-Sent Events, so the browser gets tokens as the model produces
 * them and `changed` events as the service stages drafts. Everything else here
 * is session bookkeeping.
 *
 * Unauthenticated, like `/mcp` beside it. That is not an oversight, it is the
 * gap the plan names in §7: both doors are blocked on the caller-authorization
 * model, and until then this is a single-tenant, local-or-trusted-network
 * feature. The provider key comes from the caller per request precisely so the
 * server does not have to hold one.
 */
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { createToolRegistry, type ToolRequest } from '@sparql-query-lib/tools';
import { assistantToolNames } from '../assistant/allowlist.js';
import { createAssistantService, type AssistantEvent, type AssistantService } from '../assistant/service.js';
import { parseScreenContext } from '../assistant/screen-context.js';
import {
  unconfiguredModelClientFactory,
  type ModelClientFactory,
  type ProviderCredentials,
} from '../assistant/model.js';
import { listProviderModels } from '../assistant/list-models.js';
import { DRAFT_TOOL_DEFINITIONS } from '../assistant/draft-tools.js';
import { tools as catalogue } from '@sparql-query-lib/tools';
import { createValidatorAjv } from '../lib/validator-setup.js';
import { writeSseHead } from '../lib/sse.js';

/**
 * The provider factory, settable once at boot.
 *
 * A module-level hook rather than a constructor argument because the route is
 * registered by `configureApp`, which has no business knowing about model
 * providers — and because a test needs to swap it without rebuilding the app.
 */
let modelClientFactory: ModelClientFactory = unconfiguredModelClientFactory;

export function configureAssistant(options: { modelClientFactory: ModelClientFactory }) {
  modelClientFactory = options.modelClientFactory;
}

/** For tests, and for a server that wants the default back. */
export function resetAssistantConfiguration() {
  modelClientFactory = unconfiguredModelClientFactory;
}

type SessionBody = { libraryId?: string | null };

type MessageBody = {
  prompt?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /**
   * What the sender has on screen. Untyped here on purpose —
   * `parseScreenContext` is the one place that decides what a usable context
   * is, and it never throws (#128 item 2).
   */
  context?: unknown;
};

function credentialsFrom(body: MessageBody): ProviderCredentials | null {
  if (!body.provider || !body.model) return null;
  return {
    provider: body.provider,
    model: body.model,
    apiKey: body.apiKey,
    baseUrl: body.baseUrl,
  };
}

/** One SSE frame. `event:` lets the client switch without parsing the payload. */
function writeEvent(reply: FastifyReply, event: AssistantEvent) {
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export default async function assistantRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  /*
   * One registry for the process, over the allowlist rather than the whole
   * catalogue. Building it here rather than per session is deliberate: it
   * compiles a validator per tool, and the allowlist cannot change at runtime.
   */
  const allowed = new Set(assistantToolNames());
  const registry = createToolRegistry({
    compiler: createValidatorAjv(),
    definitions: catalogue.filter((tool) => allowed.has(tool.name)),
    /*
     * Same shape as the MCP server's caller (packages/mcp-server/src/index.ts):
     * the caller's own token is merged into the injected request, so a tool runs
     * under their grants rather than as an ambient service identity. #127.
     */
    callApi: async (request: ToolRequest, authorization?: string) => {
      const withAuth: ToolRequest = authorization
        ? { ...request, headers: { ...(request.headers ?? {}), authorization } }
        : request;
      const response = await fastify.inject(withAuth as never);
      return {
        statusCode: response.statusCode,
        headers: response.headers as Record<string, unknown>,
        payload: response.payload,
      };
    },
  });

  const service: AssistantService = createAssistantService({
    registry,
    runSparql: async ({ query, backendId, authorization }) => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/sparql',
        payload: { query, backendId },
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
        },
      });
      return { text: response.payload };
    },
  });

  fastify.post('/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as SessionBody;
    const session = service.open(body.libraryId ?? null);
    return reply.status(201).send({ id: session.id, createdAt: session.createdAt, libraryId: session.libraryId });
  });

  fastify.get('/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const session = service.get(id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return reply.send({
      id: session.id,
      createdAt: session.createdAt,
      libraryId: session.libraryId,
      running: session.running,
      drafts: session.drafts.list(),
    });
  });

  /**
   * The models a key can reach, proxied rather than fetched from the browser.
   *
   * Through the server for the same reason a turn goes through the server: not
   * every provider sends CORS headers a browser will accept, and the key
   * already travels this path per request (§8). Nothing is cached — a key can
   * change between calls, and the list is small.
   */
  fastify.post('/models', async (request: FastifyRequest, reply: FastifyReply) => {
    const credentials = credentialsFrom({ ...(request.body ?? {}), model: 'unused' } as MessageBody);
    if (!credentials) return reply.status(400).send({ error: 'provider is required' });

    try {
      return reply.send({ models: await listProviderModels(credentials) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 502, not 500: the provider refused, we did not fail. The panel keeps
      // its free-text field either way, so this is informational.
      return reply.status(502).send({ error: message });
    }
  });

  /**
   * The tools this door offers, so the panel can show what it can do.
   *
   * `title` is the label to show — MCP's field for exactly this, and the one
   * the protocol says clients should prefer over `name`. `description` comes
   * along as the fallback, because most tools describe themselves in something
   * already label-length ("List queries") and do not need a second wording.
   * Both are the strings the model and every MCP client see, which is the
   * point: no display copy here to drift from them.
   */
  fastify.get('/tools', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      /*
       * The draft tools belong here too. They are not in the registry — the
       * turn loop adds them separately — but they are the ones a receipt is
       * most likely to name, because staging a query is what the assistant
       * spends its turns doing.
       */
      tools: [...registry.listTools(), ...DRAFT_TOOL_DEFINITIONS].map((tool) => ({
        name: tool.name,
        title: tool.title ?? null,
        description: tool.description,
      })),
    });
  });

  fastify.post('/sessions/:id/interrupt', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (!service.get(id)) return reply.status(404).send({ error: 'Session not found' });
    return reply.send({ interrupted: service.interrupt(id) });
  });

  fastify.post('/sessions/:id/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as MessageBody;
    const session = service.get(id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) return reply.status(400).send({ error: 'prompt is required' });

    const credentials = credentialsFrom(body);
    if (!credentials) {
      return reply.status(400).send({ error: 'provider and model are required' });
    }

    let model;
    try {
      model = modelClientFactory(credentials);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }

    // Replays the staged headers, CORS included; see `lib/sse.ts`.
    writeSseHead(reply);

    /*
     * A client that navigates away mid-turn should stop the turn, not leave it
     * burning tokens into a socket nobody is reading.
     *
     * This watches the response, not the request. Since node 16 an
     * `IncomingMessage` emits `close` once the request stream completes — for a
     * POST that is as soon as the body has been read, long before the client
     * goes anywhere. Interrupting on that aborted every turn on its first step,
     * and because an aborted stream yields no events the loop saw no tool calls
     * and reported `complete`, so the turn ended silently rather than visibly
     * failing. The response only closes early when the socket really is gone,
     * and `writableFinished` tells the ordinary `end()` apart from that.
     */
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished && session.running) service.interrupt(session.id);
    });

    try {
      const screenContext = parseScreenContext(body.context);
      for await (const event of service.runTurn(
        session,
        prompt,
        model,
        request.headers.authorization,
        screenContext
      )) {
        writeEvent(reply, event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeEvent(reply, { type: 'done', reason: 'error', message });
    } finally {
      reply.raw.end();
    }

    return reply;
  });
}
