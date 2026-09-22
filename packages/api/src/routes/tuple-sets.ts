/**
 * `/tuple-sets` — named tabular assets registered in a library.
 *
 * The tabular sibling of `/data-graphs`, and shaped the same on purpose: a
 * stable entity carrying identity, immutable versions carrying content, and a
 * `currentVersion` pointer. What differs is that content is **normalised on
 * import** — four source formats in, one SPARQL Results JSON document stored —
 * so a pinned version means the same thing forever.
 *
 * See `docs/concepts.md`.
 */

import type { FastifyInstance } from 'fastify';
import { classifyVersionPatch } from '../lib/versionPatch.js';
import { mintId } from '../lib/id.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { LdkitTupleSet } from '../persistence/schemas/TupleSetSchema.js';
import type { LdkitTupleSetVersion } from '../persistence/schemas/TupleSetVersionSchema.js';
import { TUPLE_SOURCE_FORMATS } from '../persistence/schemas/TupleSetVersionSchema.js';
import {
  reposRoute,
  validateIfMatch,
  setEntityConcurrencyHeaders,
  findVersionByNumber,
} from './route-helpers.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { analyseReferences, describeWrongType } from '../lib/entityReferences.js';
import { analyseTags } from '../lib/tagMembership.js';
import {
  TupleContentError,
  looksLikeResultsTsv,
  parseTupleContent,
  applyColumnTypes,
  suggestColumnTypes,
  SUGGESTED_COLUMN_TYPES,
} from '../lib/tupleContent.js';
import {
  createTupleSetVersion,
  annotateTupleSetVersion,
  MAX_TUPLE_SET_VERSION_BYTES,
} from '../lib/TupleSetVersionWriter.js';
import { materializeTupleSetVersionFromEtl, TupleSetEtlSourceError } from '../lib/tupleSetFromEtl.js';
import { ImmutableEntityError } from '../lib/immutability.js';
import { createTupleSetSchema, updateTupleSetSchema } from '@sparql-query-lib/contracts/schema';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { filterReadable, requireEntityMode, AuthorizationError } from '../auth/enforce.js';

export const tupleSetResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    currentVersion: { type: 'string', nullable: true },
    isPartOf: { type: 'array', items: { type: 'string' } },
    /** The argument set this table was converted from, if it was. Loose, never a pin. */
    copiedFrom: { type: 'string', nullable: true },
    tags: { type: 'array', items: { type: 'string' }, nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'name', 'isPartOf'],
  additionalProperties: false,
} as const;

const tupleSetVersionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    isPartOf: { type: 'string' },
    version: { type: 'integer' },
    immutable: { type: 'boolean', nullable: true },
    contentString: { type: 'string' },
    sourceFormat: { type: 'string', nullable: true },
    tupleColumns: { type: 'array', items: { type: 'string' }, nullable: true },
    rowCount: { type: 'integer', nullable: true },
    byteSize: { type: 'integer', nullable: true },
    sourceEtlJobVersion: { type: 'string', nullable: true },
    sourceColumnMappingVersion: { type: 'string', nullable: true },
    sourceExecutedAt: { type: 'string', format: 'date-time', nullable: true },
    sourceResultHash: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'isPartOf', 'version', 'contentString'],
  additionalProperties: false,
} as const;

/**
 * The ETL sink (issue #211). `etlJobVersionId` rather than a job id: a version
 * is what carries the SQL, and naming it is what makes the snapshot say which
 * SQL produced it. The mapping version defaults to the job version's current
 * one and may be pinned.
 */
const createTupleSetVersionFromEtlBodySchema = {
  type: 'object',
  properties: {
    etlJobVersionId: { type: 'string' },
    columnMappingVersionId: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
  },
  required: ['etlJobVersionId'],
  additionalProperties: false,
} as const;

/**
 * Column-type suggestions the author accepted (issue #208), keyed by column
 * name. Applied after parsing, before anything is persisted — so this is
 * import-time only, never a way to retype an existing version.
 */
const columnTypesPropertySchema = {
  type: 'object',
  additionalProperties: { type: 'string', enum: [...SUGGESTED_COLUMN_TYPES] },
} as const;

/**
 * `sourceFormat` is required on create and has no default.
 *
 * Plain TSV and SPARQL Results TSV share an extension and mean very different
 * things — one takes every cell as a string, the other as a typed RDF term — so
 * guessing would type or un-type a whole dataset invisibly. `/detect-format`
 * exists to pre-select a default in a UI; the caller still states the choice.
 */
const createTupleSetVersionBodySchema = {
  type: 'object',
  properties: {
    contentString: { type: 'string' },
    sourceFormat: { type: 'string', enum: [...TUPLE_SOURCE_FORMATS] },
    comment: { type: 'string', nullable: true },
    immutable: { type: 'boolean', nullable: true },
    columnTypes: columnTypesPropertySchema,
  },
  required: ['contentString', 'sourceFormat'],
  additionalProperties: false,
} as const;


/**
 * A version PATCH answers a content field with a 409 that says why, so the
 * shape carries the offending fields alongside the message.
 */
const contentPatchRejectedSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    fields: { type: 'array', items: { type: 'string' } },
  },
  required: ['error'],
} as const;

const annotateTupleSetVersionBodySchema = {
  type: 'object',
  properties: {
    contentString: { type: 'string' },
    sourceFormat: { type: 'string', enum: [...TUPLE_SOURCE_FORMATS] },
    comment: { type: 'string', nullable: true },
    immutable: { type: 'boolean', nullable: true },
  },
  additionalProperties: false,
} as const;

/**
 * The stable entity's write bodies are the generated projections of
 * `TupleSetSchema` — the same documents `packages/web`'s zod leaf is projected
 * from, so the two cannot say different things. They were hand-written literals
 * until issue #212 and had drifted: both omitted `currentVersion`, which the
 * leaf offers on create, so a client that sent it would have passed its own
 * validation and got a 400.
 *
 * The *version* bodies above stay hand-written: a version create takes
 * `contentString` plus the source format its bytes are in and stores the
 * normalised SRJ instead, which is not a projection of any entity shape.
 *
 * (`isPartOf` is typed as an array though a bare string gets through too:
 * fastify's ajv runs with `coerceTypes: 'array'`, which wraps a scalar rather
 * than rejecting it.)
 */
const createTupleSetBodySchema = createTupleSetSchema.body;
const updateTupleSetBodySchema = updateTupleSetSchema.body;

const errorResponseSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

const idParamSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

const versionParamSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, version: { type: 'string' } },
  required: ['id', 'version'],
} as const;

const listQuerystringSchema = {
  type: 'object',
  properties: { library: { type: 'string' } },
  additionalProperties: false,
} as const;

function toIsPartOfArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(value => String(value));
  return raw ? [String(raw)] : [];
}

export default async function (fastify: FastifyInstance) {
  registerEntityAuthGuard(fastify, { executeSuffixes: [], exemptSuffixes: ['/detect-format', '/preview'] });

  /**
   * Advisory only: which format a header line looks like, so an import dialog
   * can pre-select. Touches no stored entity, hence the guard exemption.
   */
  fastify.post('/detect-format', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'Suggest a source format for tabular content',
      body: {
        type: 'object',
        properties: { contentString: { type: 'string' } },
        required: ['contentString'],
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: { suggested: { type: 'string', enum: [...TUPLE_SOURCE_FORMATS] } },
          required: ['suggested'],
          additionalProperties: false,
        },
      },
    }, async ({ reply, request }) => {
    const text = String(request.body.contentString ?? '');
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{')) {
      return reply.send({ suggested: 'sparql-results-json' });
    }
    if (looksLikeResultsTsv(text)) {
      return reply.send({ suggested: 'sparql-results-tsv' });
    }
    const [header = ''] = text.split(/\r?\n/);
    return reply.send({ suggested: header.includes('\t') ? 'tsv' : 'csv' });
  }));

  /**
   * Advisory: what the rows *would* be, without storing anything.
   *
   * The same parser `POST /:id/versions` runs, stopping before the write. It
   * exists so nothing else has to reimplement it. An editor showing a preview
   * of unsaved CSV, or converting pasted CSV into the row builder, needs the
   * typed interpretation — and a client-side parser doing that would be a
   * second implementation that can disagree with this one, which is exactly the
   * drift normalising on import is there to prevent. One parser, reachable
   * before the commit.
   *
   * Touches no stored entity, hence the guard exemption. The per-version byte
   * cap still applies: it costs the same CPU to parse whether or not a write
   * follows, so the ceiling belongs here too rather than only at the write.
   * At stock settings fastify's own body limit is the same 1 MiB and rejects
   * first with a 413; this check is what answers a deployment that has lowered
   * `TUPLE_SET_MAX_VERSION_BYTES` below it, where the transport would let the
   * payload through and the write would then refuse it.
   */
  fastify.post('/preview', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'Parse tabular content without storing it',
      body: {
        type: 'object',
        properties: {
          contentString: { type: 'string' },
          sourceFormat: { type: 'string', enum: [...TUPLE_SOURCE_FORMATS] },
          columnTypes: columnTypesPropertySchema,
        },
        required: ['contentString', 'sourceFormat'],
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: {
            contentString: { type: 'string' },
            tupleColumns: { type: 'array', items: { type: 'string' } },
            rowCount: { type: 'integer' },
            byteSize: { type: 'integer' },
            columnTypeSuggestions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  column: { type: 'string' },
                  suggested: { type: 'string', enum: [...SUGGESTED_COLUMN_TYPES] },
                },
                required: ['column', 'suggested'],
                additionalProperties: false,
              },
            },
          },
          required: ['contentString', 'tupleColumns', 'rowCount', 'byteSize', 'columnTypeSuggestions'],
          additionalProperties: false,
        },
        400: errorResponseSchema,
      },
    }, async ({ reply, request }) => {
    const text = String(request.body.contentString ?? '');
    if (Buffer.byteLength(text, 'utf8') > MAX_TUPLE_SET_VERSION_BYTES) {
      return reply.status(400).send({
        error: `Tuple set content is over the ${MAX_TUPLE_SET_VERSION_BYTES}-byte limit for one version`,
      });
    }
    try {
      let parsed = parseTupleContent(text, request.body.sourceFormat);
      // Suggestions are computed off the as-parsed content, before any
      // accepted types are applied — otherwise an accepted column would
      // immediately stop being suggested, which reads as the suggestion
      // vanishing rather than as having been accepted.
      const columnTypeSuggestions = suggestColumnTypes(parsed.document);
      const columnTypes = request.body.columnTypes;
      if (columnTypes && Object.keys(columnTypes).length > 0) {
        parsed = applyColumnTypes(parsed, columnTypes);
      }
      return reply.send({
        contentString: parsed.contentString,
        tupleColumns: parsed.columns,
        rowCount: parsed.rowCount,
        byteSize: parsed.byteSize,
        columnTypeSuggestions,
      });
    } catch (error) {
      if (error instanceof TupleContentError) {
        return reply.status(400).send({ error: error.message });
      }
      throw error;
    }
  }));

  fastify.get('/', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'List tuple sets',
      querystring: listQuerystringSchema,
      response: {
        200: { type: 'array', items: tupleSetResponseSchema },
      },
    }, async ({ repos, reply, request }) => {
    const { library } = request.query;
    const items = repos.TupleSet.list() as LdkitTupleSet[];
    const scoped = library ? items.filter(set => set.isPartOf?.includes(library)) : items;
    return reply.send(filterReadable(request, scoped).map(set => toRestApi(set)));
  }));

  fastify.post('/', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'Create tuple set',
      body: createTupleSetBodySchema,
      response: {
        201: tupleSetResponseSchema,
        400: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const cacheCoordinator = getCacheCoordinator();
    const body = request.body;

    const name = String(body.name ?? '').trim();
    if (!name) {
      return reply.status(400).send({ error: 'Tuple set name is required' });
    }

    const isPartOfArray = toIsPartOfArray(body.isPartOf);
    if (isPartOfArray.length === 0) {
      return reply.status(400).send({ error: 'Tuple set must be associated with a library' });
    }

    const parents = analyseReferences('TupleSet', 'isPartOf', isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );
    if (parents.exactlyOneCount !== 1) {
      return reply.status(400).send({ error: 'Tuple set must belong to exactly one library' });
    }
    if (parents.missing.length > 0) {
      return reply.status(400).send({ error: `Referenced entity ${parents.missing[0]} does not exist` });
    }
    if (parents.wrongType.length > 0) {
      return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
    }

    const tagCheck = analyseTags('TupleSet', body.tags, isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    const created = await repos.TupleSet.create({
      $id: body.id || mintId('tupleSet'),
      name,
      description: body.description ?? null,
      isPartOf: isPartOfArray,
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
    } as Partial<LdkitTupleSet> & { $id: string });

    setEntityConcurrencyHeaders(reply, created);
    return reply.status(201).send(toRestApi(created));
  }));

  fastify.get('/:id', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'Get tuple set',
      params: idParamSchema,
      response: {
        200: tupleSetResponseSchema,
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const entity = repos.TupleSet.get(id) as LdkitTupleSet | null;
    if (!entity) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, entity);
    return reply.send(toRestApi(entity));
  }));

  fastify.put('/:id', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'Update tuple set',
      params: idParamSchema,
      body: updateTupleSetBodySchema,
      response: {
        200: tupleSetResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        412: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const updates = request.body;
    const cacheCoordinator = getCacheCoordinator();

    const current = repos.TupleSet.get(id) as LdkitTupleSet | null;
    if (!current) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    const { valid, currentTag } = validateIfMatch(request, current);
    if (!valid) {
      return reply.status(412).send({
        error: 'Precondition Failed',
        expected: currentTag,
        current: toRestApi(current),
      });
    }

    let ids: string[] | undefined;
    if (updates.isPartOf !== undefined) {
      ids = toIsPartOfArray(updates.isPartOf);
      const parents = analyseReferences('TupleSet', 'isPartOf', ids, iri => cacheCoordinator.get(iri));
      if (parents.exactlyOneCount !== 1) {
        return reply.status(400).send({ error: 'Tuple set must belong to exactly one library' });
      }
      if (parents.wrongType.length > 0) {
        return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
      }
    }

    const tagCheck = analyseTags('TupleSet', updates.tags, ids ?? current.isPartOf, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    const updated = await repos.TupleSet.update(id, {
      ...updates,
      ...(ids ? { isPartOf: ids } : {}),
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
    } as Partial<LdkitTupleSet>);
    if (!updated) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(toRestApi(updated));
  }));

  fastify.delete('/:id', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'Delete tuple set and all its versions (cascading delete)',
      params: idParamSchema,
      response: {
        204: { type: 'null' },
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const current = repos.TupleSet.get(id);
    if (!current) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    const versions = (repos.TupleSetVersion.list() as LdkitTupleSetVersion[]).filter(
      version => version.isPartOf === id
    );
    for (const version of versions) {
      await repos.TupleSetVersion.delete(version.$id);
    }

    await repos.TupleSet.delete(id);
    return reply.status(204).send();
  }));

  fastify.get('/:id/versions', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'List tuple set versions',
      params: idParamSchema,
      response: {
        200: { type: 'array', items: tupleSetVersionResponseSchema },
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    if (!repos.TupleSet.get(id)) {
      return reply.status(404).send({ error: 'Tuple set not found' });
    }
    const versions = (repos.TupleSetVersion.list() as LdkitTupleSetVersion[])
      .filter(version => version.isPartOf === id)
      .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    return reply.send(versions.map(version => toRestApi(version)));
  }));

  fastify.post('/:id/versions', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'Create tuple set version',
      params: idParamSchema,
      body: createTupleSetVersionBodySchema,
      response: {
        201: tupleSetVersionResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    if (!repos.TupleSet.get(id)) {
      return reply.status(404).send({ error: 'Tuple set not found' });
    }

    const body = request.body;
    try {
      const created = await createTupleSetVersion(id, {
        contentString: String(body.contentString ?? ''),
        sourceFormat: body.sourceFormat,
        comment: body.comment ?? null,
        immutable: body.immutable ?? undefined,
        columnTypes: body.columnTypes ?? undefined,
      });
      setEntityConcurrencyHeaders(reply, created);
      return reply.status(201).send(toRestApi(created));
    } catch (error) {
      if (error instanceof TupleContentError) {
        return reply.status(400).send({ error: error.message });
      }
      throw error;
    }
  }));

  // POST /:id/versions/from-etl — a version materialized by running an ETL
  // job's SQL, rather than uploaded by hand. The tabular twin of
  // `/data-graphs/:id/versions/from-query`; see `tupleSetFromEtl.ts` (#211).
  fastify.post('/:id/versions/from-etl', ...reposRoute({
      tags: ['TupleSet'],
      summary: "Create a tuple set version by running an ETL job version's SQL",
      params: idParamSchema,
      body: createTupleSetVersionFromEtlBodySchema,
      response: {
        // 200 is the unchanged re-run: the SQL was run, it produced what the
        // current version already holds from the same job and mapping version,
        // and no version was cut (#211's version churn). The body is the
        // version either way; the status is what says which happened.
        200: tupleSetVersionResponseSchema,
        201: tupleSetVersionResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
        502: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    if (!repos.TupleSet.get(id)) {
      return reply.status(404).send({ error: 'Tuple set not found' });
    }

    const body = request.body;
    try {
      const { version, reused } = await materializeTupleSetVersionFromEtl(
        id,
        {
          etlJobVersionId: body.etlJobVersionId,
          columnMappingVersionId: body.columnMappingVersionId ?? null,
          comment: body.comment ?? null,
        },
        { request },
      );
      setEntityConcurrencyHeaders(reply, version);
      return reply.status(reused ? 200 : 201).send(toRestApi(version));
    } catch (error) {
      if (error instanceof TupleSetEtlSourceError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      if (error instanceof AuthorizationError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      if (error instanceof TupleContentError) {
        return reply.status(400).send({ error: error.message });
      }
      throw error;
    }
  }));

  /*
   * The three routes below match versions by `isPartOf` and never look the
   * tuple set in the path up, so the plugin guard's premise does not hold for
   * them: it resolves `:id` through the cache and abstains on a miss, because
   * "a miss is a 404 the handler will produce" — true where the handler reads
   * the same id, and false here. So each one checks the version it is about to
   * serve, the way `queries.ts` does.
   *
   * A healthy version resolves through its tuple set to the library exactly as
   * the guard did, so this adds nothing for one; a version whose set no longer
   * resolves has no library, and `requireLibraryMode(null, …)` refuses where
   * the guard abstained.
   */
  fastify.get('/:id/versions/:version', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'Get tuple set version',
      params: versionParamSchema,
      response: {
        200: tupleSetVersionResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const versions = repos.TupleSetVersion.list() as LdkitTupleSetVersion[];
    const lookup = findVersionByNumber(versions, id, version, 'tuple set');
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    requireEntityMode(request, lookup.version, 'read');
    setEntityConcurrencyHeaders(reply, lookup.version);
    return reply.send(toRestApi(lookup.version));
  }));

  // PATCH /tuple-sets/:id/versions/:version — annotate a version
  //
  // A version is a snapshot (issue #192): the rows are what was imported, and
  // an argument set or test that names this version was checked against those
  // rows. Only the comment is writable.
  fastify.patch('/:id/versions/:version', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'Annotate a tuple set version (comment only; content is immutable)',
      params: versionParamSchema,
      body: annotateTupleSetVersionBodySchema,
      response: {
        200: tupleSetVersionResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        409: contentPatchRejectedSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const versions = repos.TupleSetVersion.list() as LdkitTupleSetVersion[];
    const lookup = findVersionByNumber(versions, id, version, 'tuple set');
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    requireEntityMode(request, lookup.version, 'write');

    const { annotations, rejection } = classifyVersionPatch(request.body as Record<string, unknown>);
    if (rejection) return reply.status(rejection.status).send(rejection);

    try {
      const updated = await annotateTupleSetVersion(lookup.version.$id, {
        comment: annotations.comment as string | null | undefined,
        immutable: annotations.immutable as boolean | undefined,
      });
      setEntityConcurrencyHeaders(reply, updated);
      return reply.send(toRestApi(updated));
    } catch (error) {
      if (error instanceof ImmutableEntityError) {
        return reply.status(409).send({ error: error.message });
      }
      if (error instanceof TupleContentError) {
        return reply.status(400).send({ error: error.message });
      }
      throw error;
    }
  }));

  fastify.delete('/:id/versions/:version', ...reposRoute({
      tags: ['TupleSet'],
      summary: 'Delete tuple set version',
      params: versionParamSchema,
      response: {
        204: { type: 'null' },
        400: errorResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const versions = repos.TupleSetVersion.list() as LdkitTupleSetVersion[];
    const lookup = findVersionByNumber(versions, id, version, 'tuple set');
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    requireEntityMode(request, lookup.version, 'delete');
    // No immutability check here, and deliberately: every version is frozen on
    // create now (issue #192), so this guard would mean no tuple set version
    // could ever be deleted. Immutability is about a version's *content* not
    // changing under a reference — removing one is the pruning the same
    // decision names as the answer to version growth, not an edit.

    await repos.TupleSetVersion.delete(lookup.version.$id);

    // Deleting what the parent points at would leave a dangling pointer, so it
    // falls back to the highest remaining version — or to nothing.
    const parent = repos.TupleSet.get(id) as LdkitTupleSet | null;
    if (parent?.currentVersion === lookup.version.$id) {
      const remaining = (repos.TupleSetVersion.list() as LdkitTupleSetVersion[])
        .filter(candidate => candidate.isPartOf === id)
        .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
      await repos.TupleSet.update(id, {
        currentVersion: remaining[0]?.$id ?? null,
      } as Partial<LdkitTupleSet>);
    }

    return reply.status(204).send();
  }));
}
