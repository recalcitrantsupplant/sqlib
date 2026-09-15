import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityRepositories } from '../lib/EntityRepositories.js';
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
  canReadEntity,
  filterReadable,
  requireCuratedBackendsChange,
  requireLibraryCreate,
  requireLibraryMode,
  type CuratedBackendFields,
} from '../auth/enforce.js';
import { getAuthStore } from '../auth/AuthStore.js';
import { reposRoute, withReposHandler, validateIfMatch, setEntityConcurrencyHeaders } from './route-helpers.js';
import { RDF_MEDIA_TYPES } from '../types/media-types.js';
import { SystemQueryRunner, type SystemQueryRunnerResult } from '../lib/system-queries/SystemQueryRunner.js';
import { collectLibraryQueries } from '../lib/export/collectLibraryQueries.js';
import {
  collectLibraryGroups,
  type ExportGroupInput,
  type GroupGraphEntity,
  type SkippedGroup,
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

/**
 * The RDF dump of the library collection, narrowed to what the caller may read.
 *
 * `GET /libraries` filters its JSON with `filterReadable`, and the RDF branch
 * beside it ran `libraryCollection` — which constructs from *every* stored
 * `Library` — so an `Accept` header was the difference between "the libraries
 * you may read" and "every library in the deployment". `GET /libraries/export`
 * is the same query again with no `:id` for a guard to resolve and no check of
 * its own at all. Both come through here now.
 *
 * A caller who may read everything is still answered by `libraryCollection`:
 * the store is the authority on what exists, and describing the cache's list
 * instead would silently narrow an administrator's dump to whatever the cache
 * happens to hold. Everyone else gets `libraryDescribe` bound to the readable
 * IRIs — its `VALUES (?library)` slot takes as many rows as it is given, and
 * zero rows when that is none, which `applyArguments` substitutes as an empty
 * `VALUES` and the store answers with a well-formed empty document.
 *
 * Empty rather than 403, for the reason the JSON listing answers `[]`: "which
 * of these may I see" has an answer even when the answer is none, and it says
 * nothing about what exists.
 */
async function readableLibraryCollection(
  request: FastifyRequest,
  repos: EntityRepositories,
  acceptHeader: string
): Promise<SystemQueryRunnerResult> {
  const all = repos.Library.list() as LdkitLibrary[];
  const visible = filterReadable(request, all);

  if (visible.length === all.length) {
    return systemQueryRunner.execute('libraryCollection', { acceptHeader });
  }

  return systemQueryRunner.execute('libraryDescribe', {
    acceptHeader,
    parameterBindings: [
      {
        vars: ['library'],
        bindings: visible.map(library => ({
          library: { type: 'uri', value: library.$id as string },
        })),
      },
    ],
  });
}

/**
 * Splits collected groups into the ones this caller may be handed and the ones
 * whose legs reach a library they may not read.
 *
 * A group is selected for the bundle by *its own* library, but a `QueryNode`'s
 * `queryId` is a `QueryVersion` that need not live there — the canvas composes
 * legs across libraries, which is the reach #489 closed at composition time by
 * requiring Execute on each source. The bundle is the other end of it: it
 * carries every node's query *text*, so exporting a leg the caller cannot read
 * would make Read on this library a read of the other one's queries, through a
 * door that hands the result out as a file.
 *
 * **Read, not Execute**, unlike the check at composition: a bundle stores no
 * query and runs nothing here — it copies stored text into an artifact, which
 * is what Read on that library governs everywhere else (the argument-set pins
 * settled the same way).
 *
 * Withheld rather than refused, and reported in `skipped` beside the groups the
 * static runtime cannot run: a library whose one cross-library group may not
 * travel should still export its queries and its other groups, which is the
 * policy `collectLibraryGroups` already states for every other reason a group
 * is left out.
 */
function partitionByReadableNodes(
  request: FastifyRequest,
  groups: ExportGroupInput[]
): { exportable: ExportGroupInput[]; withheld: SkippedGroup[] } {
  const exportable: ExportGroupInput[] = [];
  const withheld: SkippedGroup[] = [];
  const cache = getCacheCoordinator();

  for (const group of groups) {
    const unreadable = group.nodes.find(
      node => !canReadEntity(request, cache.get(node.sourceVersion))
    );
    if (unreadable) {
      withheld.push({
        id: group.sourceGroup,
        name: group.name,
        reason:
          `Its node ${unreadable.key} runs query version ${unreadable.sourceVersion}, `
          + 'which belongs to a library you may not read.',
      });
      continue;
    }
    exportable.push(group);
  }

  return { exportable, withheld };
}

export default async function (fastify: FastifyInstance) {
  fastify.get(
    '/export',
    withReposHandler(async ({ repos, reply, request }) => {
      const accept = negotiateRdfMediaType(request.headers.accept) ?? RDF_MEDIA_TYPES.N_TRIPLES;
      const execution = await readableLibraryCollection(request, repos, accept);
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
          const { exportable, withheld } = partitionByReadableNodes(request, groups);
          const { skipped: skippedGroups } = await attachGroupsToBundle(bundle, exportable);

          const allSkipped = [
            ...skipped,
            ...skippedExamples,
            ...skippedGroupReads,
            ...withheld,
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
        const execution = await readableLibraryCollection(request, repos, rdfType);
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
      const library = repos.Library.get(id) as LdkitLibrary | null;
      if (!library) {
        return reply.status(404).send({ error: 'Not Found' });
      }
      // Before the content negotiation, not inside one arm of it: the RDF
      // branch below used to run its own get-and-404 and then describe the
      // library without asking, so `Accept: text/turtle` read a library that
      // the JSON branch three lines down refuses.
      requireLibraryMode(request, id, 'read');

      const rdfType = negotiateRdfMediaType(request.headers.accept);
      if (rdfType) {
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

      /*
       * A create that names an existing IRI is not a create. `CacheCoordinator
       * .create` does not look: it inserts and replaces the cache entry, and
       * the grant below then hands the caller every mode on that IRI — so
       * posting a library whose id is one you cannot read was a way to take it
       * over, along with everything in it. Refused as a conflict, before
       * anything is written and before any grant is minted.
       */
      if (providedId && repos.Library.get(id)) {
        return reply.status(409).send({
          error: `Library ${id} already exists. Update it instead, or create one without an id.`,
        });
      }

      // The curated-backends escalation guard applies to a library's first
      // state as much as to a change of it: `allowedBackends` and
      // `defaultBackend` are both in this body, and both grant reach to anyone
      // holding Execute here (design §4.3). Checked before the write.
      requireCuratedBackendsChange(request, id, null, rest);

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

      // Extending the curated set hands execution reach to everyone holding
      // Execute here, so it needs Control plus Use on what is added (design
      // §4.3). Checked before the write, not after.
      //
      // Both fields, and unconditionally: the guard was reached only when the
      // body carried `allowedBackends`, so a PUT naming an unheld backend as
      // this library's `defaultBackend` — which `curatedBackendsOf` grants the
      // same reach — walked past it. A field the body omits keeps its current
      // value, which the guard then reads as unchanged and lets through.
      const patch = body as CuratedBackendFields;
      requireCuratedBackendsChange(request, id, current, {
        allowedBackends: Object.prototype.hasOwnProperty.call(body, 'allowedBackends')
          ? patch.allowedBackends
          : current.allowedBackends,
        defaultBackend: Object.prototype.hasOwnProperty.call(body, 'defaultBackend')
          ? patch.defaultBackend
          : current.defaultBackend,
      });

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
