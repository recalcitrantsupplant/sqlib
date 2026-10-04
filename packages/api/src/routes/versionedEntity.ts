/**
 * The CRUD every versioned entity shares, written once.
 *
 * A versioned entity is a stable identity (`Query`, `Rule`, `DataGraph` …) plus
 * immutable versions of its content (`QueryVersion` …) whose `isPartOf` names
 * it. Each of the nine nouns used to hand-write the same ten routes, and the
 * copies drifted (review finding D1): `/v` beside `/versions`, DELETE answering
 * 204 for a missing id in one module and 404 in the next, cascading versions in
 * some and orphaning them in others, `ImmutableEntityError` as 400 here and 409
 * there, version PATCH honouring If-Match only for queries, and explicit
 * library checks present in three modules and absent in four. Every security
 * fix that landed in one module and not its siblings was that drift made
 * concrete. So the routes are produced here, and a module supplies only what
 * is genuinely its own: schemas, how a version is written and shown, and the
 * hooks below.
 *
 * The decisions, the same for every noun:
 *
 * - **Paths.** `/`, `/:id`, `/:id/versions`, `/:id/versions/:version`. There is
 *   no `/v` alias (decision D1).
 * - **Not found.** A missing entity is 404 on every route, DELETE included. A
 *   version route 404s a missing parent before it looks for the version, and
 *   a non-numeric `:version` is 400.
 * - **Authorization.** The plugin guard checks the entity in the path; these
 *   routes also check explicitly, so a handler does not depend on which ids
 *   the guard happens to resolve: Read on a get, Write on a create (on the
 *   body's library) and update (on the destination library too, when the body
 *   moves it), Delete on a delete. A version route checks *the version* it
 *   serves, so one whose parent no longer resolves is refused rather than
 *   waved through. Listings are filtered to what the caller may read.
 * - **Containment.** `isPartOf` is checked against the entity model's
 *   `@references`: every reference must exist and have an allowed type, and
 *   exactly one must be a library. One wording for that rule.
 * - **Concurrency.** PUT and version PATCH honour If-Match. A mismatch is 412
 *   with `{ error, expected, current }`, `current` shown the way a GET shows it.
 * - **Delete.** DELETE cascades to the versions, unless a version is pinned by
 *   another saved version, in which case it is refused with 409 and the list
 *   of who holds the pin (`lib/versionPins.ts`). A version DELETE applies the
 *   same rule to the one version, and moves the parent's `currentVersion` to
 *   the highest remaining version (or to nothing).
 * - **Errors.** A version PATCH may carry annotations only
 *   (`lib/versionPatch.ts`); content is 409, a system field 400.
 *   `ImmutableEntityError` is 409 everywhere. A version create that fails with
 *   a `ValidationError` is 400 with its message; anything unanticipated is a
 *   500 with a fixed sentence, logged in full.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityType } from '../lib/EntityRegistry.js';
import { getCacheCoordinator, getEntityRepositories } from '../lib/CacheCoordinatorProvider.js';
import { analyseReferences, describeWrongType } from '../lib/entityReferences.js';
import { analyseTags } from '../lib/tagMembership.js';
import { mintId } from '../lib/id.js';
import { classifyVersionPatch } from '../lib/versionPatch.js';
import { describePins, pinsOn } from '../lib/versionPins.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import {
  filterReadable,
  requireContainmentWritable,
  requireEntityMode,
} from '../auth/enforce.js';
import {
  RouteError,
  findVersionByNumber,
  reposRoute,
  setEntityConcurrencyHeaders,
  validateIfMatch,
} from './route-helpers.js';

/** An entity or version as the cache holds it. */
export type StoredEntity = Record<string, unknown> & {
  $id: string;
  isPartOf?: string | string[] | null;
  version?: number | string | null;
  currentVersion?: string | null;
  dateModified?: string | null;
};

type Body = Record<string, unknown>;
type RouteSchema = Record<string, unknown>;

/** A route schema per generated route. Each may omit `params`; the standard ones are filled in. */
export interface VersionedEntitySchemas {
  list: RouteSchema;
  create: RouteSchema;
  get: RouteSchema;
  update: RouteSchema;
  delete: RouteSchema;
  listVersions: RouteSchema;
  createVersion: RouteSchema;
  getVersion: RouteSchema;
  patchVersion: RouteSchema;
  deleteVersion: RouteSchema;
}

export interface CreateVersionContext {
  request: FastifyRequest;
  reply: FastifyReply;
  parent: StoredEntity;
  body: Body;
}

export interface CreatedVersion {
  created: StoredEntity;
  /** 201 unless the writer says otherwise. */
  status?: number;
  /** The response body; the version as `presentVersion` shows it when absent. */
  body?: unknown;
}

export interface VersionedEntityOptions {
  /** Lower-case singular, as a sentence uses it: "query", "data graph". */
  noun: string;
  type: EntityType;
  versionType: EntityType;
  /** `lib/id.ts` kind for a minted id. */
  idKind: string;
  /** Whether a create may name its own id (a clash is 409 from the coordinator). */
  acceptCallerId?: boolean;
  /** `isPartOf` is stored as a list (most nouns) or a single IRI (query groups). */
  containment?: 'list' | 'single';
  schemas: VersionedEntitySchemas;

  /** How an entity is shown. `toRestApi` by default. */
  present?: (entity: StoredEntity, request: FastifyRequest) => unknown;
  /** How a version is shown. `toRestApi` by default. */
  presentVersion?: (version: StoredEntity, request: FastifyRequest) => unknown | Promise<unknown>;
  /** How a version is shown in the version listing. `presentVersion` by default. */
  presentVersionInList?: (version: StoredEntity, request: FastifyRequest) => unknown | Promise<unknown>;
  /** Narrow the collection listing by its querystring, before the read filter. */
  filterList?: (items: StoredEntity[], request: FastifyRequest) => StoredEntity[];

  /**
   * Fields beyond name, description, containment and tags for a new entity.
   * `tags` is what the body asked for after checking (undefined: not given),
   * and a returned `tags` replaces it. Throw a `RouteError` to refuse.
   */
  beforeCreate?: (ctx: {
    request: FastifyRequest;
    body: Body;
    isPartOf: string[];
    tags: string[] | undefined;
  }) => Body | Promise<Body>;
  /** Check or reshape an update after the generic checks. Throw a `RouteError` to refuse. */
  beforeUpdate?: (ctx: {
    request: FastifyRequest;
    current: StoredEntity;
    updates: Body;
  }) => void | Promise<void>;

  /** Write a version. The parent exists and the caller may write it. */
  createVersion: (ctx: CreateVersionContext) => Promise<CreatedVersion>;
  /**
   * An error from `createVersion` this noun answers itself, as a `RouteError`;
   * null to let the default mapping decide.
   */
  mapCreateVersionError?: (error: unknown) => RouteError | null;
  /** Flatten a PATCH body before it is classified (a wrapped `{ queryGroupVersion: … }`). */
  unwrapVersionPatch?: (body: unknown) => Body;
  /** Apply annotations to a version. A repository update by default. */
  annotateVersion?: (version: StoredEntity, annotations: Body) => Promise<StoredEntity | null>;
  /** Delete one version and whatever it owns. A repository delete by default. */
  deleteVersion?: (version: StoredEntity) => Promise<void>;
}

interface Store {
  get(id: string): StoredEntity | null;
  list(): StoredEntity[];
  create(entity: StoredEntity): Promise<StoredEntity>;
  update(id: string, updates: Body): Promise<StoredEntity | null>;
  delete(id: string): Promise<void>;
}

function storeOf(type: EntityType): Store {
  return getEntityRepositories()[type] as unknown as Store;
}

const idParams = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

const versionParams = {
  type: 'object',
  properties: { id: { type: 'string' }, version: { type: 'string' } },
  required: ['id', 'version'],
} as const;

/**
 * Every refusal these routes give carries `error` and may carry more — `usedBy`
 * on a pinned delete, `fields` on a refused PATCH, `expected` and `current` on
 * a 412. A response schema that declared `error` alone would have the
 * serializer drop the rest, so error statuses are declared open.
 */
const refusalSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: true,
} as const;

const REFUSAL_STATUSES = [400, 404, 409, 412, 422] as const;

function withStandardParts(schema: RouteSchema, params: object | null): RouteSchema {
  const response = { ...((schema.response as Record<string, unknown> | undefined) ?? {}) };
  for (const status of REFUSAL_STATUSES) response[status] = refusalSchema;
  return {
    ...schema,
    ...(params && !schema.params ? { params } : {}),
    response,
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean);
  return typeof value === 'string' && value ? [value] : [];
}

function byVersionAsc(a: StoredEntity, b: StoredEntity): number {
  return Number(a.version ?? 0) - Number(b.version ?? 0);
}

function isClientError(error: unknown): boolean {
  if (error instanceof RouteError) return true;
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

export function registerVersionedEntityRoutes(fastify: FastifyInstance, options: VersionedEntityOptions): void {
  const {
    noun,
    type,
    versionType,
    schemas,
    containment = 'list',
  } = options;
  const Noun = capitalise(noun);
  const present = options.present ?? ((entity: StoredEntity) => toRestApi(entity));
  const presentVersion = options.presentVersion ?? ((version: StoredEntity) => toRestApi(version));
  const presentVersionInList = options.presentVersionInList ?? presentVersion;

  const entities = () => storeOf(type);
  const versions = () => storeOf(versionType);
  const lookup = (id: string) => getCacheCoordinator().get(id) as Record<string, unknown> | null;

  const versionsOf = (parentId: string) =>
    versions().list().filter(version => toIdList(version.isPartOf).includes(parentId)).sort(byVersionAsc);

  function requireParent(id: string): StoredEntity {
    const parent = entities().get(id);
    if (!parent) throw new RouteError(404, { error: `${Noun} not found` });
    return parent;
  }

  function requireVersion(parentId: string, rawVersion: string): StoredEntity {
    const found = findVersionByNumber(
      versions().list() as Array<StoredEntity & { isPartOf?: string; version?: number }>,
      parentId,
      rawVersion,
      noun,
    );
    if (!found.ok) throw new RouteError(found.status, { error: found.error });
    return found.version;
  }

  /** Normalise and check `isPartOf` against the entity model's `@references`. */
  function checkContainment(raw: unknown): string[] {
    const ids = toIdList(raw);
    const findings = analyseReferences(type, 'isPartOf', ids, lookup);
    if (findings.missing.length > 0) {
      throw new RouteError(400, { error: `Referenced entity ${findings.missing[0]} does not exist` });
    }
    if (findings.wrongType.length > 0) {
      throw new RouteError(400, { error: describeWrongType(findings.wrongType[0]) });
    }
    const libraries = findings.exactlyOneCount ?? ids.length;
    if (libraries !== 1 || (containment === 'single' && ids.length !== 1)) {
      throw new RouteError(400, { error: `${Noun} must belong to exactly one library` });
    }
    return ids;
  }

  function storedContainment(ids: string[]): string | string[] {
    return containment === 'single' ? ids[0] : ids;
  }

  function preconditionFailed(currentTag: string | null, current: unknown): RouteError {
    return new RouteError(412, { error: 'Precondition Failed', expected: currentTag, current });
  }

  function refusePins(subject: string, versionIds: string[]): void {
    const pins = pinsOn(versionIds);
    if (pins.length > 0) {
      throw new RouteError(409, { error: describePins(subject, pins), usedBy: pins });
    }
  }

  const deleteVersion = options.deleteVersion ?? ((version: StoredEntity) => versions().delete(version.$id));

  // GET / — the entities the caller may read
  fastify.get('/', ...reposRoute(withStandardParts(schemas.list, null), async ({ request, reply }) => {
    const all = entities().list();
    const narrowed = options.filterList ? options.filterList(all, request) : all;
    return reply.send(filterReadable(request, narrowed).map(entity => present(entity, request)));
  }));

  // POST / — create the stable entity; versions come after
  fastify.post('/', ...reposRoute(withStandardParts(schemas.create, null), async ({ request, reply }) => {
    const body = (request.body ?? {}) as Body;

    let name = body.name;
    if (typeof name === 'string') {
      name = name.trim();
      if (!name) throw new RouteError(400, { error: `${Noun} name is required` });
    }

    const isPartOf = checkContainment(body.isPartOf);
    const tagCheck = analyseTags(type, body.tags, isPartOf, lookup);
    if (!tagCheck.ok) throw new RouteError(400, { error: tagCheck.error });

    // The library is the unit of sharing: creating inside it needs Write there.
    requireEntityMode(request, { isPartOf }, 'write');

    const extra = options.beforeCreate
      ? await options.beforeCreate({ request, body, isPartOf, tags: tagCheck.tags })
      : {};

    const callerId = options.acceptCallerId && typeof body.id === 'string' && body.id ? body.id : null;
    const toCreate: StoredEntity = {
      $id: callerId ?? mintId(options.idKind),
      ...(name !== undefined ? { name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      isPartOf: storedContainment(isPartOf),
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
      ...extra,
    };

    const created = await entities().create(toCreate);
    setEntityConcurrencyHeaders(reply, created);
    return reply.status(201).send(present(created, request));
  }));

  // GET /:id
  fastify.get('/:id', ...reposRoute(withStandardParts(schemas.get, idParams), async ({ request, reply }) => {
    const { id } = request.params as { id: string };
    const entity = requireParent(id);
    requireEntityMode(request, entity, 'read');
    setEntityConcurrencyHeaders(reply, entity);
    return reply.send(present(entity, request));
  }));

  // PUT /:id — metadata, containment, tags, or the current-version pointer
  fastify.put('/:id', ...reposRoute(withStandardParts(schemas.update, idParams), async ({ request, reply }) => {
    const { id } = request.params as { id: string };
    const current = requireParent(id);
    const updates: Body = { ...((request.body ?? {}) as Body) };

    requireEntityMode(request, current, 'write');
    // Write on the destination library too, when the body moves it.
    requireContainmentWritable(request, current, updates);

    const { valid, currentTag } = validateIfMatch(request, current);
    if (!valid) throw preconditionFailed(currentTag, present(current, request));

    if (typeof updates.name === 'string') {
      updates.name = updates.name.trim();
      if (!updates.name) throw new RouteError(400, { error: `${Noun} name is required` });
    }

    if (updates.isPartOf !== undefined && updates.isPartOf !== null) {
      updates.isPartOf = storedContainment(checkContainment(updates.isPartOf));
    }

    // Judged against the containment this write leaves behind, so moving and
    // retagging in one request is checked against the destination library.
    const tagCheck = analyseTags(
      type,
      updates.tags,
      (updates.isPartOf ?? current.isPartOf) as string[] | string | null | undefined,
      lookup,
    );
    if (!tagCheck.ok) throw new RouteError(400, { error: tagCheck.error });
    if (tagCheck.tags !== undefined) updates.tags = tagCheck.tags;

    if (options.beforeUpdate) await options.beforeUpdate({ request, current, updates });

    const updated = await entities().update(id, updates);
    if (!updated) throw new RouteError(404, { error: `${Noun} not found` });
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(present(updated, request));
  }));

  // DELETE /:id — the entity and its versions, unless a version is pinned
  fastify.delete('/:id', ...reposRoute(withStandardParts(schemas.delete, idParams), async ({ request, reply }) => {
    const { id } = request.params as { id: string };
    const current = requireParent(id);
    requireEntityMode(request, current, 'delete');

    const owned = versionsOf(id);
    refusePins(noun, owned.map(version => version.$id));

    for (const version of owned) await deleteVersion(version);
    await entities().delete(id);
    return reply.status(204).send();
  }));

  // GET /:id/versions — oldest first
  fastify.get('/:id/versions', ...reposRoute(withStandardParts(schemas.listVersions, idParams), async ({ request, reply }) => {
    const { id } = request.params as { id: string };
    const parent = requireParent(id);
    requireEntityMode(request, parent, 'read');
    const readable = filterReadable(request, versionsOf(id));
    return reply.send(await Promise.all(readable.map(version => presentVersionInList(version, request))));
  }));

  // POST /:id/versions — a new immutable version
  fastify.post('/:id/versions', ...reposRoute(withStandardParts(schemas.createVersion, idParams), async ({ request, reply }) => {
    const { id } = request.params as { id: string };
    const parent = requireParent(id);
    requireEntityMode(request, parent, 'write');

    let result: CreatedVersion;
    try {
      result = await options.createVersion({ request, reply, parent, body: (request.body ?? {}) as Body });
    } catch (error) {
      const mapped = options.mapCreateVersionError?.(error);
      if (mapped) throw mapped;
      if (isClientError(error)) throw error;
      // Logged in full and answered with a fixed sentence: a store error can
      // carry a SPARQL fragment or an IRI from another library.
      request.log.error({ err: error }, `Failed to create ${noun} version`);
      throw new RouteError(500, { error: `Failed to create ${noun} version` });
    }

    setEntityConcurrencyHeaders(reply, result.created);
    const responseBody = result.body !== undefined
      ? result.body
      : await presentVersion(result.created, request);
    return reply.status(result.status ?? 201).send(responseBody);
  }));

  // GET /:id/versions/:version
  fastify.get('/:id/versions/:version', ...reposRoute(withStandardParts(schemas.getVersion, versionParams), async ({ request, reply }) => {
    const { id, version: rawVersion } = request.params as { id: string; version: string };
    requireParent(id);
    const version = requireVersion(id, rawVersion);
    requireEntityMode(request, version, 'read');
    setEntityConcurrencyHeaders(reply, version);
    return reply.send(await presentVersion(version, request));
  }));

  // PATCH /:id/versions/:version — annotations only; a version is a snapshot
  fastify.patch('/:id/versions/:version', ...reposRoute(withStandardParts(schemas.patchVersion, versionParams), async ({ request, reply }) => {
    const { id, version: rawVersion } = request.params as { id: string; version: string };
    requireParent(id);
    const existing = requireVersion(id, rawVersion);
    requireEntityMode(request, existing, 'write');

    const body = options.unwrapVersionPatch ? options.unwrapVersionPatch(request.body) : (request.body ?? {}) as Body;
    const { annotations, rejection } = classifyVersionPatch(body, { ignore: ['dateModified'] });
    if (rejection) throw new RouteError(rejection.status, { ...rejection });

    const { valid, currentTag } = validateIfMatch(request, existing);
    if (!valid) throw preconditionFailed(currentTag, await presentVersion(existing, request));

    const updated = Object.keys(annotations).length === 0
      ? existing
      : await (options.annotateVersion
        ? options.annotateVersion(existing, annotations)
        : versions().update(existing.$id, annotations));
    if (!updated) throw new RouteError(404, { error: `${Noun} version not found` });

    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(await presentVersion(updated, request));
  }));

  // DELETE /:id/versions/:version — unless pinned
  fastify.delete('/:id/versions/:version', ...reposRoute(withStandardParts(schemas.deleteVersion, versionParams), async ({ request, reply }) => {
    const { id, version: rawVersion } = request.params as { id: string; version: string };
    const parent = requireParent(id);
    const version = requireVersion(id, rawVersion);
    requireEntityMode(request, version, 'delete');
    // No immutability check, deliberately: immutability is about a version's
    // content not changing under a reference, and pruning one nobody pins is
    // not an edit. A pinned one is the reference, so it is refused.
    refusePins(`${noun} version`, [version.$id]);

    await deleteVersion(version);

    // Deleting what the parent points at would leave a dangling pointer, so
    // it falls back to the highest remaining version, or to nothing.
    if (parent.currentVersion === version.$id) {
      const remaining = versionsOf(id);
      await entities().update(id, { currentVersion: remaining[remaining.length - 1]?.$id ?? null });
    }
    return reply.status(204).send();
  }));
}
