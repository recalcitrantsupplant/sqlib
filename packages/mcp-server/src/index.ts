import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import {
  catalogueGuide,
  compileToolValidators,
  createToolRegistry,
  formatValidationErrors,
  tools,
  type CompiledValidator,
  type ToolRegistry,
  type ToolRequest,
  type ToolValidatorCompiler,
} from '@sparql-query-lib/tools';

import {
  listUiResources,
  readUiResource,
  resultUiMeta,
  toolVisibleToModel,
  uiSupported,
  withUiMeta,
} from './ui-apps.js';

export { formatValidationErrors };

/**
 * The caller's own bearer token, lifted off the inbound HTTP request.
 *
 * Small enough to inline, and deliberately not inlined: this is the hinge the
 * security model turns on. The token rides every API call the tool makes, so
 * the API applies *that caller's* grants rather than an ambient service
 * identity — and a silent `undefined` here would downgrade every call to
 * anonymous without failing anything. It has a test.
 *
 * `ctx.http` is absent over stdio, where there is no HTTP request and no token
 * to forward. In v2 the request is a web-standard `Request`, so `headers.get`
 * returns the single joined value or null, and v1's array-or-string dance is
 * gone.
 */
export function authorizationFromContext(ctx: {
  http?: { req?: { headers: { get(name: string): string | null } } };
}): string | undefined {
  return ctx.http?.req?.headers.get('authorization') ?? undefined;
}

export type CreateMcpServerOptions = {
  name?: string;
  version?: string;
  /**
   * The server-level `instructions` MCP returns from `initialize`, which
   * clients place in the model's system prompt before it sees any tool.
   * Defaults to the catalogue guide (`catalogueGuide` in the tools package):
   * the entity model, how a query declares parameters, and the shape of
   * `arguments`. Pass `''` to publish none.
   */
  instructions?: string;
  fastifyInstance?: FastifyInstance;
  enableCacheMonitoring?: boolean;
  fastifyLogger?: boolean;
  skipAppSetup?: boolean;
};

// MCP clients (notably ChatGPT) enforce tool name pattern ^[a-zA-Z0-9_-]+$.
// Sanitize our dot-delimited names to keep registration compatible.
export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Compiled once for the process, not once per server.
 *
 * `startStreamableHttpMcpServer` calls `createMcpServer` per MCP *session*, and
 * building a fresh ajv and compiling all 79 schemas measures ~105ms — a cost
 * every new session would otherwise pay for an identical result. The tool
 * catalogue is a module-level constant, so the validators cannot vary between
 * sessions.
 *
 * Sharing compiled validators across sessions is safe despite ajv storing the
 * last run's errors on the function object: `validate()` and the read of
 * `validate.errors` happen in the same synchronous expression in `callTool`,
 * with no await between them.
 */
let toolValidators: Promise<{ compiler: ToolValidatorCompiler; validators: Map<string, CompiledValidator> }> | null = null;

function getToolValidators() {
  toolValidators ??= (async () => {
    const compiler = ((await loadApiModule()).createValidatorAjv as () => ToolValidatorCompiler)();
    return { compiler, validators: compileToolValidators(compiler, tools) };
  })();
  return toolValidators;
}

/**
 * `app.inject` in the shape the registry asks for.
 *
 * The cast is the one place fastify's types meet the catalogue's: a tool's
 * payload is an arbitrary JSON body (`unknown`), while `InjectOptions` wants
 * fastify's narrower `InjectPayload`. Every payload the catalogue builds is a
 * plain object it just constructed, so the widening is safe here and keeps the
 * tools package free of a fastify dependency.
 */
function injectCaller(app: FastifyInstance) {
  return async (request: ToolRequest, authorization?: string) => {
    // The MCP server enforces nothing — it is a client. The caller's own bearer
    // token rides every API call, per request, so the API applies that caller's
    // grants rather than an ambient service identity.
    const withAuth: ToolRequest = authorization
      ? { ...request, headers: { ...(request.headers ?? {}), authorization } }
      : request;
    const response = await app.inject(withAuth as InjectOptions);
    return {
      statusCode: response.statusCode,
      headers: response.headers as Record<string, unknown>,
      payload: response.payload,
    };
  };
}

async function buildMcpToolRegistry(app: FastifyInstance): Promise<ToolRegistry> {
  const { compiler, validators } = await getToolValidators();
  return createToolRegistry({
    compiler,
    validators,
    callApi: injectCaller(app),
    definitions: tools,
    // MCP clients (notably ChatGPT) enforce ^[a-zA-Z0-9_-]+$ on tool names.
    publicName: sanitizeToolName,
  });
}

/**
 * Load `packages/api`, preferring the built package and falling back to source
 * during dev. Both `configureApp` and `createValidatorAjv` come from here, so
 * the fallback lives in one place.
 */
async function loadApiModule(): Promise<Record<string, unknown>> {
  try {
    return (await import('@sparql-query-lib/api')) as unknown as Record<string, unknown>;
  } catch {
    const devModulePath = new URL('../../api/src/index.ts', import.meta.url).href;
    return (await import(devModulePath)) as Record<string, unknown>;
  }
}

async function buildApiApp(options: {
  fastifyInstance?: FastifyInstance;
  enableCacheMonitoring?: boolean;
  fastifyLogger?: boolean;
  skipAppSetup?: boolean;
}) {
  const apiApp =
    options.fastifyInstance ??
    Fastify({
      logger: options.fastifyLogger ?? true,
      bodyLimit: 100 * 1024 * 1024,
    });
  if (options.skipAppSetup) {
    return { apiApp, teardown: async () => { /* no-op: lifecycle managed by caller */ } };
  }
  const configureAppFn = (await loadApiModule()).configureApp as (
    app: FastifyInstance,
    opts: { enableCacheMonitoring: boolean; registerSwagger: boolean }
  ) => Promise<{ teardown: () => Promise<void> }>;
  const { teardown } = await configureAppFn(apiApp, { enableCacheMonitoring: options.enableCacheMonitoring ?? false, registerSwagger: false });
  return { apiApp, teardown };
}

export async function createMcpServer(options: CreateMcpServerOptions = {}) {
  const name = options.name ?? 'sparql-query-lib-mcp';
  const version = options.version ?? '0.0.1';

  const { apiApp, teardown } = await buildApiApp({
    fastifyInstance: options.fastifyInstance,
    enableCacheMonitoring: options.enableCacheMonitoring ?? false,
    fastifyLogger: options.fastifyLogger,
    skipAppSetup: options.skipAppSetup ?? false,
  });

  // Resolved unconditionally, including under `skipAppSetup` — the caller may
  // own the app's lifecycle, but the tool registry still needs validators.
  // Memoised across sessions; see getToolValidators.
  const toolsRegistry = await buildMcpToolRegistry(apiApp);

  // Tool names in the guide are rendered the way this door publishes them,
  // so the model reads `queries_createVersion`, which it can call, rather than
  // `queries.createVersion`, which it cannot.
  const instructions = options.instructions ?? catalogueGuide(sanitizeToolName);

  const server = new Server(
    { name, version },
    {
      // `resources` is advertised unconditionally: the Views are resources
      // whatever the client does with them, and a client that ignores the UI
      // extension simply never reads one.
      capabilities: { tools: {}, resources: {} },
      ...(instructions ? { instructions } : {}),
    },
  );

  /**
   * Whether this session's client renders MCP Apps.
   *
   * Read per request rather than captured once: `initialize` may not have
   * happened when the handlers are registered, and a session is one client, so
   * the answer cannot change mid-session once it is known.
   */
  const clientRendersApps = () => uiSupported(server.getClientCapabilities());

  server.setRequestHandler('tools/list', async () => {
    const uiEnabled = clientRendersApps();
    return {
      tools: toolsRegistry
        .listTools()
        .filter((tool) => toolVisibleToModel(tool))
        .map((tool) => withUiMeta(tool, uiEnabled)),
    };
  });

  server.setRequestHandler('resources/list', async () => ({
    resources: listUiResources(),
  }));

  server.setRequestHandler('resources/read', async (request) => {
    const resource = readUiResource(request.params.uri);
    if (!resource) throw new Error(`Unknown resource: ${request.params.uri}`);
    return resource;
  });

  server.setRequestHandler('tools/call', async (request, ctx) => {
    const authorization = authorizationFromContext(ctx);
    const result = await toolsRegistry.callTool(
      request.params.name,
      (request.params.arguments ?? {}) as Record<string, unknown>,
      authorization
    );
    // MCP's own envelope, built from the registry's protocol-neutral result.
    // `_meta.ui` names the View that renders it, which is how a host knows to
    // open the bench rather than print JSON. The text content stays either
    // way: a View is an addition to the result, never a replacement for it,
    // and the model still needs to read what happened.
    const definition = toolsRegistry.definitions.find(
      (tool) => sanitizeToolName(tool.name) === request.params.name
    );
    const meta = resultUiMeta(definition, clientRendersApps());
    return {
      content: [{ type: 'text' as const, text: result.text }],
      structuredContent: {
        statusCode: result.statusCode,
        headers: result.headers,
        body: result.body,
      },
      ...(meta ? { _meta: meta } : {}),
    };
  });

  const shutdown = async () => {
    await teardown();
  };

  return { server, apiApp, shutdown };
}

export async function startStdioMcpServer(options: CreateMcpServerOptions = {}) {
  const { server, apiApp, shutdown } = await createMcpServer({
    ...options,
    fastifyLogger: options.fastifyLogger ?? false,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, transport, apiApp, shutdown };
}
