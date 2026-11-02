/**
 * The HTTP door to the published tools: one route per tool, generated when the
 * server starts, and an OpenAPI document per library.
 *
 * - `GET /tools/{slug}/{name}` for a tool that only reads, its arguments in the
 *   query string. A list is the key repeated; a `term` or `langString` object
 *   is its JSON spelling.
 * - `POST /tools/{slug}/{name}` for a tool backed by an update, or by a rule
 *   set, its arguments as a JSON object. A reading tool that takes `data`
 *   answers both, so RDF longer than a URL can go in the body.
 * - `GET /tools/{slug}/openapi.json`: OpenAPI 3.1, one operation per tool.
 *
 * A route per tool, not one route with the tool as a parameter, is what lets
 * each operation carry its own schema in that document.
 *
 * Each call builds the same request the MCP door builds
 * (`buildPublishedRequest` in the tools package): `POST /execute`, or
 * `POST /rule-sets/{id}/execute` for a rule set. It sends it through
 * `app.inject` with the caller's own `Authorization` header, so a published
 * tool grants nothing that the same call on the same version would not.
 *
 * Not under `src/routes/`: that directory holds the plugins whose routes the
 * auth route-coverage test enumerates and classifies one by one, and these are
 * not known until the store is. Every one of them is the check of the route it
 * reaches through `inject`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  PublishedToolArgumentError,
  buildPublishedRequest,
  formatValidationErrors,
  publishedAcceptsPost,
  publishedHttpMethod,
  publishedInputSchema,
  publishedOpenApiDocument,
  publishedToolPath,
  valuesFromQueryString,
  type CompiledValidator,
  type PublishedToolSpec,
} from '@sparql-query-lib/tools';
import type { PublishedCatalogue } from '../lib/publishedTools.js';
import { createValidatorAjv } from '../lib/validator-setup.js';

/** Response headers worth passing back from `/execute`. */
const FORWARDED_HEADERS = ['content-type', 'server-timing', 'x-resolved-target', 'x-result-node', 'etag', 'last-modified', 'cache-control'];

export async function registerPublishedToolRoutes(
  app: FastifyInstance,
  options: {
    catalogue: PublishedCatalogue;
    /** The prefix the API's routes are registered under, which `inject` needs. */
    basePath: string;
    /** The prefix clients see, for the OpenAPI document's `servers`. */
    publicBasePath: string;
  },
): Promise<void> {
  const { catalogue, basePath, publicBasePath } = options;
  const ajv = createValidatorAjv();

  for (const [slug, library] of catalogue.libraries) {
    const specs = catalogue.specs.filter(spec => spec.slug === slug);
    const document = publishedOpenApiDocument({
      slug,
      title: library.name,
      description: library.description,
      specs,
      basePath: publicBasePath,
    });
    app.get(`/tools/${slug}/openapi.json`, { schema: { hide: true } }, async (_request, reply) =>
      reply.header('content-type', 'application/json').send(document));
  }

  for (const spec of catalogue.specs) {
    const validate = ajv.compile(publishedInputSchema(spec)) as CompiledValidator;
    const handler = (request: FastifyRequest, reply: FastifyReply) =>
      callPublishedTool(app, spec, validate, basePath, request, reply);
    const url = publishedToolPath(spec.slug, spec.name);
    if (publishedHttpMethod(spec) === 'GET') {
      app.get(url, { schema: { hide: true } }, handler);
      if (publishedAcceptsPost(spec)) app.post(url, { schema: { hide: true } }, handler);
    } else {
      app.post(url, { schema: { hide: true } }, handler);
    }
  }
}

async function callPublishedTool(
  app: FastifyInstance,
  spec: PublishedToolSpec,
  validate: CompiledValidator,
  basePath: string,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  let built;
  try {
    const values = request.method === 'GET'
      ? valuesFromQueryString(spec, request.query as Record<string, string | string[] | undefined>)
      : structuredClone((request.body ?? {}) as Record<string, unknown>);
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return reply.code(400).send({ error: 'The arguments must be a JSON object.' });
    }
    // Validated in the same expression that reads the errors: the compiled
    // function keeps the last run's errors on itself.
    if (!validate(values)) {
      return reply.code(400).send({ error: formatValidationErrors(validate.errors) });
    }
    built = buildPublishedRequest(spec, values);
  } catch (error) {
    if (error instanceof PublishedToolArgumentError) {
      return reply.code(400).send({ error: error.message });
    }
    throw error;
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (typeof request.headers.authorization === 'string') headers.authorization = request.headers.authorization;
  if (typeof request.headers.accept === 'string') headers.accept = request.headers.accept;

  const response = await app.inject({ method: 'POST', url: `${basePath}${built.url}`, headers, payload: built.payload as object });
  for (const name of FORWARDED_HEADERS) {
    const value = response.headers[name];
    if (value !== undefined) reply.header(name, value);
  }
  return reply.code(response.statusCode).send(response.rawPayload);
}
