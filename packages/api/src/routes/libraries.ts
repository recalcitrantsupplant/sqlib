import type { FastifyInstance, FastifyReply } from 'fastify';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { LdkitLibrary } from '../persistence/schemas/LibrarySchema.js';
import type { LibraryRestApi } from '@sparql-query-lib/contracts/schema';
import {
  getLibrarysSchema,
  getLibrarySchema,
  createLibrarySchema,
  updateLibrarySchema,
  deleteLibrarySchema,
} from '@sparql-query-lib/contracts/schema';
import { mintId } from '../lib/id.js';
import {
  authOf,
  filterReadable,
  requireAllowedBackendsChange,
  requireLibraryCreate,
  requireLibraryMode,
} from '../auth/enforce.js';
import { getAuthStore } from '../auth/AuthStore.js';
import { reposRoute, withReposHandler, validateIfMatch, setEntityConcurrencyHeaders } from './route-helpers.js';
import { RDF_MEDIA_TYPES } from '../types/media-types.js';
import { SystemQueryRunner, type SystemQueryRunnerResult } from '../lib/system-queries/SystemQueryRunner.js';
import { collectLibraryQueries } from '../lib/export/collectLibraryQueries.js';
import {
  collectLibraryGroups,
  type GroupGraphEntity,
} from '../lib/export/collectLibraryGroups.js';
import { attachGroupsToBundle } from '../lib/export/groupBundle.js';
import { buildExportBundle, QueryExportError } from '../lib/export/queryBundle.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import {
  attachExamplesToBundle,
  type ExampleMode,
} from '../lib/export/collectQueryExamples.js';
import { generateDemoPage } from '../lib/export/demoPage.js';
import { generateNotebook } from '../lib/export/notebook.js';
import { ArgumentSetService } from '../lib/ArgumentSetService.js';
import type { LdkitTest } from '../persistence/schemas/TestSchema.js';
import type { LdkitTestVersion } from '../persistence/schemas/TestVersionSchema.js';
import type { LdkitTestCase } from '../persistence/schemas/TestCaseSchema.js';
import type { LdkitQuery } from '../persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { LdkitQueryGroup } from '../persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryGroupVersion } from '../persistence/schemas/QueryGroupVersionSchema.js';

const systemQueryRunner = new SystemQueryRunner();
// Resolves a test case's stored argument set into the runtime's own payload
// shape, which is what makes a TestCase usable as an example verbatim.
const argumentSetService = new ArgumentSetService();
const RDF_MEDIA_TYPE_LIST = Object.values(RDF_MEDIA_TYPES);
const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  [RDF_MEDIA_TYPES.TURTLE]: 'ttl',
  [RDF_MEDIA_TYPES.N_TRIPLES]: 'nt',
  [RDF_MEDIA_TYPES.RDF_XML]: 'rdf',
  [RDF_MEDIA_TYPES.JSON_LD]: 'jsonld',
  [RDF_MEDIA_TYPES.N3]: 'n3',
  [RDF_MEDIA_TYPES.TRIG]: 'trig',
  [RDF_MEDIA_TYPES.N_QUADS]: 'nq',
};

function negotiateRdfMediaType(acceptHeader?: string | string[] | null): string | null {
  if (!acceptHeader) return null;
  const raw = Array.isArray(acceptHeader) ? acceptHeader.join(',') : acceptHeader;
  if (!raw) return null;
  const tokens = raw.split(',').map(part => part.split(';')[0].trim().toLowerCase()).filter(Boolean);
  for (const token of tokens) {
    if ((RDF_MEDIA_TYPE_LIST as readonly string[]).includes(token)) {
      return token;
    }
  }
  return null;
}

function mediaTypeToExtension(mediaType: string): string {
  return MEDIA_TYPE_EXTENSIONS[mediaType] || 'txt';
}

/** Comma-separated tag IRIs, whitespace-tolerant and duplicate-free. */
function parseTagList(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const value of raw.split(',').map(part => part.trim()).filter(Boolean)) {
    seen.add(value);
  }
  return [...seen];
}

function sanitizeFilenameSegment(value: string): string {
  const slug = value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return slug || 'library';
}

async function streamSystemQueryResult(
  reply: FastifyReply,
  result: SystemQueryRunnerResult,
  fallbackType: string,
  filename?: string
) {
  if (result.mode !== 'stream' || !result.stream) {
    throw new Error('System query did not return a streamable response');
  }

  const contentType = result.contentType || fallbackType;
  reply.header('Content-Type', contentType);
  if (filename) {
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
  }

  const headers = result.stream.headers ?? {};
  for (const [name, value] of Object.entries(headers)) {
    if (!value) continue;
    const lower = name.toLowerCase();
    if (lower === 'content-type' || lower === 'content-length') continue;
    reply.header(name, String(value));
  }

  reply.status(result.stream.statusCode ?? 200);
  return reply.send(result.stream.body);
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    '/export',
    withReposHandler(async ({ reply, request }) => {
      const accept = negotiateRdfMediaType(request.headers.accept) ?? RDF_MEDIA_TYPES.N_TRIPLES;
      const execution = await systemQueryRunner.execute('libraryCollection', {
        acceptHeader: accept,
      });
      const ext = mediaTypeToExtension(accept);
      return streamSystemQueryResult(reply, execution, accept, `libraries.${ext}`);
    })
  );

  const libraryIdParamSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
    },
    required: ['id'],
    additionalProperties: false,
  } as const;

  fastify.get(
    '/:id/export',
    ...reposRoute({ params: libraryIdParamSchema }, async ({ repos, reply, request }) => {
      const { id } = request.params;
      const library = repos.Library.get(id) as LdkitLibrary | null;
      if (!library) {
        return reply.status(404).send({ error: 'Not Found' });
      }
      requireLibraryMode(request, id, 'read');

      const accept = negotiateRdfMediaType(request.headers.accept) ?? RDF_MEDIA_TYPES.N_TRIPLES;
      const execution = await systemQueryRunner.execute('libraryDescribe', {
        acceptHeader: accept,
        parameterBindings: [
          {
            vars: ['library'],
            bindings: [{ library: { type: 'uri', value: id } }],
          },
        ],
      });

      const ext = mediaTypeToExtension(accept);
      const filename = `library-${sanitizeFilenameSegment(id)}.${ext}`;
      return streamSystemQueryResult(reply, execution, accept, filename);
    })
  );

  /**
   * GET /libraries/:id/export-bundle — the library's queries and query groups,
   * compiled for client-side execution.
   *
   * The response is the artifact `@sparql-query-lib/runtime` reads: each query's
   * canonical text plus the span of every parameter slot, verified at compile
   * time against the AST path. An app that holds this needs no sqlib server to
   * run the queries — only an endpoint to run them against.
   *
   * A group travels when its nodes are queries and its edges chain rows; one
   * that moves RDF, or runs a rule set or an ETL job, needs a store the static
   * runtime does not have and is reported in `skipped` instead.
   *
   * Read-only and reads-only: an update query is refused rather than exported,
   * because a bundle carries no authorization of its own. See
   * `docs/guides/static-export.md`.
   */
  fastify.get(
    '/:id/export-bundle',
    ...reposRoute(
      {
        tags: ['Library'],
        summary: 'Export a library\'s queries and groups as a static, parser-free bundle',
        params: libraryIdParamSchema,
        querystring: {
          type: 'object',
          properties: {
            tag: { type: 'string', description: 'Comma-separated tag IRIs to filter by.' },
            match: { type: 'string', enum: ['any', 'all'], default: 'any' },
            examples: {
              type: 'string',
              enum: ['all', 'first', 'none'],
              default: 'all',
              description: "Runnable examples drawn from the library's tests.",
            },
            expected: {
              type: 'boolean',
              default: false,
              description: 'Carry each example\'s recorded result. Reference only, never an assertion.',
            },
            format: {
              type: 'string',
              enum: ['json', 'html', 'ipynb'],
              default: 'json',
              description:
                'html returns a self-contained page that runs the bundle; ipynb returns a Jupyter notebook of worked calls.',
            },
          },
          additionalProperties: false,
        },
      } as const,
      async ({ repos, reply, request }) => {
        const { id } = request.params;
        const library = repos.Library.get(id) as LdkitLibrary | null;
        if (!library) {
          return reply.status(404).send({ error: 'Not Found' });
        }
        requireLibraryMode(request, id, 'read');

        const tags = parseTagList(request.query.tag);
        const { queries, skipped } = collectLibraryQueries(
          {
            listQueries: () => repos.Query.list() as LdkitQuery[],
            getQueryVersion: (versionId) =>
              repos.QueryVersion.get(versionId) as LdkitQueryVersion | null,
          },
          id,
          { tags, match: request.query.match ?? 'any' }
        );

        try {
          const bundle = await buildExportBundle({
            library: { id, name: library.name },
            queries,
            tags,
          });

          // Examples come from the library's own tests, and a test that cannot
          // become one is reported beside the queries that could not be
          // exported — the same channel, because it is the same kind of news.
          const { skipped: skippedExamples } = await attachExamplesToBundle(
            bundle,
            {
              listTests: () => repos.Test.list() as LdkitTest[],
              getTestVersion: (versionId) =>
                repos.TestVersion.get(versionId) as LdkitTestVersion | null,
              getTestCase: (caseId) => repos.TestCase.get(caseId) as LdkitTestCase | null,
              resolveArgumentPayload: (argumentSetVersionId) =>
                argumentSetService.exportRuntimePayload([argumentSetVersionId]).then(payload => ({
                  arguments: payload.tupleList,
                  limits: payload.limits,
                  offsets: payload.offsets,
                })),
            },
            id,
            {
              mode: (request.query.examples ?? 'all') as ExampleMode,
              includeExpected: request.query.expected === true,
            }
          );

          // Groups after examples, because a group may bring a query of its own
          // into the bundle and those carry no examples of their own: a test
          // names a query, and the group's node pins whichever version it pins.
          const { groups, skipped: skippedGroupReads } = collectLibraryGroups(
            {
              listGroups: () => repos.QueryGroup.list() as LdkitQueryGroup[],
              getGroupVersion: (versionId) =>
                repos.QueryGroupVersion.get(versionId) as LdkitQueryGroupVersion | null,
              getEntity: (entityId) =>
                getCacheCoordinator().get(entityId) as GroupGraphEntity | null,
            },
            id,
            { tags, match: request.query.match ?? 'any' }
          );
          const { skipped: skippedGroups } = await attachGroupsToBundle(bundle, groups);

          const allSkipped = [
            ...skipped,
            ...skippedExamples,
            ...skippedGroupReads,
            ...skippedGroups,
          ];

          if (request.query.format === 'html') {
            return reply
              .type('text/html; charset=utf-8')
              .send(generateDemoPage(bundle, { skipped: allSkipped }));
          }

          if (request.query.format === 'ipynb') {
            return reply
              .type('application/x-ipynb+json; charset=utf-8')
              .send(generateNotebook(bundle, { skipped: allSkipped }));
          }

          // `skipped` rides alongside the bundle rather than being logged and
          // forgotten: a caller needs to see that a draft query is missing.
          return reply.send({ bundle, skipped: allSkipped });
        } catch (error) {
          if (error instanceof QueryExportError) {
            return reply.status(error.statusCode).send({ error: error.message });
          }
          throw error;
        }
      }
    )
  );

  // GET /libraries - Lightning fast cache read
  fastify.get<{ Reply: LibraryRestApi[] }>(
    '/',
    ...reposRoute(getLibrarysSchema, async ({ repos, reply, request }) => {
      const rdfType = negotiateRdfMediaType(request.headers.accept);
      if (rdfType) {
        const execution = await systemQueryRunner.execute('libraryCollection', {
          acceptHeader: rdfType,
        });
        return streamSystemQueryResult(reply, execution, rdfType);
      }

      const ldkitLibraries = repos.Library.list() as LdkitLibrary[];
      const visible = filterReadable(request, ldkitLibraries);
      return reply.send(visible.map(lib => toRestApi<any>(lib)));
    })
  );

  // GET /libraries/:id - Fast cache read
  fastify.get<{ Reply: LibraryRestApi }>(
    '/:id',
    ...reposRoute(getLibrarySchema, async ({ repos, reply, request }) => {
      const { id } = request.params;
      const rdfType = negotiateRdfMediaType(request.headers.accept);
      if (rdfType) {
        const library = repos.Library.get(id) as LdkitLibrary | null;
        if (!library) {
          return reply.status(404).send({ error: 'Not Found' });
        }
        const execution = await systemQueryRunner.execute('libraryDescribe', {
          acceptHeader: rdfType,
          parameterBindings: [
            {
              vars: ['library'],
              bindings: [{ library: { type: 'uri', value: id } }],
            },
          ],
        });
        return streamSystemQueryResult(reply, execution, rdfType);
      }

      const library = repos.Library.get(id) as LdkitLibrary | null;
      if (!library) {
        return reply.status(404).send({ error: 'Not Found' });
      }
      requireLibraryMode(request, id, 'read');
      setEntityConcurrencyHeaders(reply, library);
      return reply.send(toRestApi<any>(library));
    })
  );

  // POST /libraries - Write-through cache
  fastify.post<{ Reply: LibraryRestApi }>(
    '/',
    ...reposRoute(createLibrarySchema, async ({ repos, reply, request }) => {
      requireLibraryCreate(request);

      const { id: providedId, ...rest } = request.body;
      const id = providedId || mintId('library');
      const libraryData = { ...rest, $id: id };
      const createdLibrary = await repos.Library.create(libraryData);

      // Creator becomes owner in the same operation, so a library can never be
      // created with nobody able to administer it (design §4.2).
      const context = authOf(request);
      if (!context.fullAccess) {
        await getAuthStore().createGrant({
          principal: context.subject,
          resourceKind: 'library',
          resource: id,
          modes: ['read', 'write', 'execute', 'delete', 'control'],
          grantedBy: context.subject,
        });
      }

      setEntityConcurrencyHeaders(reply, createdLibrary);
      return reply.status(201).send(toRestApi<any>(createdLibrary));
    })
  );

  // PUT /libraries/:id - Write-through cache
  fastify.put<{ Reply: LibraryRestApi }>(
    '/:id',
    ...reposRoute(updateLibrarySchema, async ({ repos, reply, request }) => {
      const { id } = request.params;
      const body = request.body;
      const current = repos.Library.get(id) as LdkitLibrary | null;
      if (!current) {
        return reply.status(404).send({ error: 'Not Found' });
      }

      requireLibraryMode(request, id, 'write');

      // Extending allowedBackends hands curated-execution reach to everyone
      // holding Execute here, so it needs Control plus Use on what is added
      // (design §4.3). Checked before the write, not after.
      if (Object.prototype.hasOwnProperty.call(body, 'allowedBackends')) {
        requireAllowedBackendsChange(
          request,
          id,
          current.allowedBackends,
          (body as { allowedBackends?: string[] | null }).allowedBackends
        );
      }

      const { valid, currentTag } = validateIfMatch(request, current);
      if (!valid) {
        return reply.status(412).send({
          error: 'Precondition Failed',
          expected: currentTag,
          current: toRestApi<any>(current),
        });
      }

      const updatedLibrary = await repos.Library.update(id, body);
      if (!updatedLibrary) {
        return reply.status(404).send({ error: 'Not Found' });
      }
      setEntityConcurrencyHeaders(reply, updatedLibrary);
      return reply.send(toRestApi<any>(updatedLibrary));
    })
  );

  // DELETE /libraries/:id - Write-through cache
  fastify.delete(
    '/:id',
    ...reposRoute(deleteLibrarySchema, async ({ repos, reply, request }) => {
      const { id } = request.params;
      requireLibraryMode(request, id, 'delete');
      await repos.Library.delete(id);
      // Grants outlive nothing: a deleted library must not leave grants that a
      // later library reusing the IRI would silently inherit.
      await getAuthStore().deleteGrantsForLibrary(id);
      return reply.status(204).send();
    })
  );
}
