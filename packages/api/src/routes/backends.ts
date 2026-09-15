import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import { toError } from '../lib/toError.js';
import {
  backendTypeIriToKey,
  backendTypeKeyToIri,
  isOxigraphStoreMode,
  OXIGRAPH_STORE_MODES,
  resolveOxigraphConfig,
  type BackendTypeKey,
  type LdkitBackend,
  type OxigraphConfig,
} from '../persistence/schemas/BackendSchema.js';
import { classifyDataGraphSource } from '../lib/dataGraphHydration.js';
import {
  buildBackendAuthEnvVarNames,
  ensureAuthEnvKey,
  normalizeAuthEnvKey,
} from '@sparql-query-lib/types';
import type { EntityRepositories } from '../lib/EntityRepositories.js';
import {
  fetchRemotePrefixes,
  pushPrefixes,
  PrefixServiceError,
  PREFIX_BATCH_LIMIT,
  type PrefixBatch,
  type PrefixTarget,
} from '../lib/prefixService.js';
import {
  forgetProbeResult,
  listProbeHistory,
  listProbeResults,
  probeBackend,
  probeBackends,
  type BackendProbeResult,
  type ProbeTarget,
} from '../lib/backendProbe.js';
import type {
  Backend,
  BackendCreate,
  BackendUpdate,
} from '@sparql-query-lib/contracts';
import {
  backendSchema,
  getBackendsSchema,
  getBackendSchema,
  createBackendSchema,
  updateBackendSchema,
  deleteBackendSchema,
} from '@sparql-query-lib/contracts/schema';
import { mintId } from '../lib/id.js';
import { toPatchView } from './patches.js';
import { buildPatchLog, PATCH_LOG_STATUSES } from '../lib/patchLog.js';
import { PatchLogService, PatchLogUnavailableError } from '../lib/PatchLogService.js';
import { oxigraphStoreManager } from '../lib/OxigraphStoreManager.js';
import { markStoreWritten } from '../lib/storeWrites.js';
import { MultipartFile } from '@fastify/multipart';
import { reposRoute, validateIfMatch, setEntityConcurrencyHeaders } from './route-helpers.js';
import path from 'node:path';
import { authOf, requireAdmin, requireBackendMode } from '../auth/enforce.js';

type ErrorResponse = { error: string; [key: string]: unknown };

/**
 * One service for the process, because it holds only the dynamic import's
 * result: every database it opens belongs to one request and dies with it.
 */
const patchLogService = new PatchLogService();

class BackendPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendPayloadError';
  }
}

function getOxigraphRoot(): string {
  return path.resolve(process.env.OXIGRAPH_STORAGE_DIR || './storage/oxigraph');
}

function normalizePersistPath(rawPath: unknown): string {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new BackendPayloadError('oxigraphConfig.persistPath is required for persistent stores.');
  }
  const root = getOxigraphRoot();
  const trimmed = rawPath.trim();
  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(root, trimmed);

  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    throw new BackendPayloadError(`oxigraphConfig.persistPath must reside under ${root}`);
  }

  return candidate;
}

/**
 * `$ref: 'backend#'` in the route responses needs the entity document present.
 * `configureApp` registers every schema in the hub, so this only fires when the
 * plugin is mounted on a bare fastify instance — which the route tests do.
 */
function ensureBackendSchemaRegistered(fastify: FastifyInstance) {
  const registered = fastify.getSchemas();
  if (!(backendSchema.$id in registered)) {
    fastify.addSchema(backendSchema);
  }
}

function normalizeDateValue(value: unknown): string | undefined {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function serializeBackend(entity: LdkitBackend): Backend {
  const rest = toRestApi<any>(entity);
  delete rest.username;
  delete rest.password;

  const backendTypeValue = rest.backendType;
  const backendTypeKey = typeof backendTypeValue === 'string'
    ? backendTypeIriToKey(backendTypeValue)
    : undefined;

  if (!backendTypeKey) {
    throw new Error(`Backend ${entity.$id} has unsupported backend type IRI: ${String(backendTypeValue)}`);
  }

  const normalized = {
    ...rest,
    backendType: backendTypeKey,
    dateCreated: normalizeDateValue(rest.dateCreated),
    dateModified: normalizeDateValue(rest.dateModified),
    oxigraphConfig: typeof rest.oxigraphConfig === 'object' && rest.oxigraphConfig !== null
      ? JSON.stringify(rest.oxigraphConfig)
      : rest.oxigraphConfig,
  };
  // No zod parse here. Verified redundant: `toRestApi` already yields exactly
  // the response shape (nothing stripped, added, or changed), and every backend
  // route declares a `$ref: backend#` response schema, so fastify serialises
  // through it and emits only declared properties. The unsupported-backendType
  // guard above is the check that was actually doing work.
  return normalized as Backend;
}

/**
 * The stored form of a request's `oxigraphConfig`, plus the object to check it by.
 *
 * The parsed object is what validation reads; the string is what is written,
 * because the property is stored verbatim as a literal and an object reaches
 * the store as `"[object Object]"` — present in the writing process's cache
 * and gone at the next reload. Re-stringified rather than passed through so
 * the persisted document is the normalised one (`persistPath`).
 */
function mapOxigraphConfig(
  value: string | null | undefined,
): { stored: string | null; config: OxigraphConfig | null } | undefined {
  if (value === undefined) return undefined;
  if (value === null) return { stored: null, config: null };
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BackendPayloadError('oxigraphConfig must be a JSON object string');
    }

    if (parsed.storeType === 'persistent') {
      parsed.persistPath = normalizePersistPath(parsed.persistPath);
    }

    return { stored: JSON.stringify(parsed), config: parsed as OxigraphConfig };
  } catch (error) {
    if (error instanceof BackendPayloadError) {
      throw error;
    }
    throw new BackendPayloadError('oxigraphConfig must be a valid JSON object string');
  }
}

/**
 * Check the `oxigraphMemory` half of an oxigraphConfig at write time.
 *
 * Catching a bad source reference here rather than at hydration matters: a
 * backend whose sources do not resolve is not discovered until something tries
 * to query it, which is usually far from whoever wrote the config. The rules
 * are the same ones `classifyDataGraphSource` enforces, reused rather than
 * restated so the route and the loader cannot drift apart.
 *
 * Only the shape is checked, not whether the ids exist — a backend may
 * legitimately be created before the data graph it points at, and existence is
 * re-checked at hydration anyway.
 */
function validateOxigraphMemoryConfig(
  backendTypeKey: BackendTypeKey | undefined,
  config: OxigraphConfig | null,
): void {
  if (!config) return;
  // Also validated when the type is absent but the config carries memory-store
  // fields, which is the shape a PATCH takes: the request may change `sources`
  // without restating `backendType`, and skipping the check there would let an
  // invalid source reference in through the one path that does not name a type.
  const carriesMemoryFields = config.mode !== undefined || config.sources !== undefined;
  if (backendTypeKey !== 'oxigraphMemory' && !carriesMemoryFields) return;

  if (config.mode !== undefined && !isOxigraphStoreMode(config.mode)) {
    throw new BackendPayloadError(
      `oxigraphConfig.mode must be one of ${OXIGRAPH_STORE_MODES.join(', ')}`,
    );
  }

  if (config.sources !== undefined) {
    if (!Array.isArray(config.sources)) {
      throw new BackendPayloadError('oxigraphConfig.sources must be an array');
    }
    for (const source of config.sources) {
      if (typeof source !== 'object' || source === null) {
        throw new BackendPayloadError('Each oxigraphConfig.sources entry must be an object');
      }
      try {
        classifyDataGraphSource(source);
      } catch (error) {
        throw new BackendPayloadError((error as Error).message);
      }
    }
  }
}

function buildCreateBackendPayload(input: BackendCreate, generatedId: string): (Partial<LdkitBackend> & { $id: string }) {
  const {
    id: _dropId,
    endpoint,
    authEnvKey,
    oxigraphConfig,
    name,
    description,
    backendType,
  } = input;

  const backendTypeKey = backendTypeIriToKey(backendType);
  if (!backendTypeKey) {
    throw new BackendPayloadError(`Unsupported backend type: ${backendType}`);
  }
  const backendTypeIri = backendTypeKeyToIri(backendTypeKey);

  const payload: Partial<LdkitBackend> & { $id: string } = {
    $id: generatedId,
    name,
    backendType: backendTypeIri,
  };

  if (description !== undefined) {
    payload.description = description;
  }
  if (endpoint !== undefined && endpoint !== null) {
    payload.endpoint = endpoint;
  }
  const resolvedAuthKey = ensureAuthEnvKey({ provided: authEnvKey ?? undefined, fallbackName: name });
  if (resolvedAuthKey && (backendTypeKey === 'http' || authEnvKey)) {
    payload.authEnvKey = resolvedAuthKey;
  }

  const mappedConfig = mapOxigraphConfig(oxigraphConfig);
  if (mappedConfig !== undefined) {
    validateOxigraphMemoryConfig(backendTypeKey, mappedConfig.config);
    payload.oxigraphConfig = mappedConfig.stored;
  }

  return payload;
}

/** The backends this caller may see — the same rule `GET /` applies. */
function visibleBackends(repos: EntityRepositories, request: FastifyRequest): LdkitBackend[] {
  const all = repos.Backend.list() as LdkitBackend[];
  const context = authOf(request);
  if (context.fullAccess || context.grants.admin) {
    return all;
  }
  return all.filter((backend) => context.grants.backends.has(backend.$id));
}

function toProbeTarget(backend: LdkitBackend): ProbeTarget {
  const backendTypeKey = backendTypeIriToKey(backend.backendType) ?? 'http';
  return {
    id: backend.$id,
    backendType: backendTypeKey,
    endpoint: backend.endpoint ?? null,
    authEnvKey: backend.authEnvKey ?? null,
  };
}

const probeResponseSchema = {
  type: 'object',
  properties: {
    backendId: { type: 'string' },
    health: { type: 'string' },
    latencyMs: { type: ['number', 'null'] },
    product: { type: ['string', 'null'] },
    probedAt: { type: 'string' },
    error: { type: ['string', 'null'] },
    httpStatus: { type: ['number', 'null'] },
    prefixes: {
      type: ['object', 'null'],
      properties: {
        read: { type: ['string', 'null'] },
        write: { type: ['string', 'null'] },
        readEndpoint: { type: ['string', 'null'] },
        writeEndpoint: { type: ['string', 'null'] },
        count: { type: ['number', 'null'] },
      },
    },
  },
} as const;

const prefixPairSchema = {
  type: 'object',
  properties: {
    prefix: { type: 'string' },
    namespace: { type: 'string' },
  },
  required: ['prefix', 'namespace'],
  additionalProperties: false,
} as const;

/**
 * An HTTP backend's prefix service target.
 *
 * In-process oxigraph stores have no prefix map to sync with — they are built
 * from sources on every use — so they are refused here rather than being
 * handed an empty endpoint to fetch.
 */
type RemotePrefixesReply = Awaited<ReturnType<typeof fetchRemotePrefixes>>;
type PrefixPushReply = { results: Awaited<ReturnType<typeof pushPrefixes>>; applied: number; failed: number };

function toPrefixTarget(backend: LdkitBackend): PrefixTarget {
  const backendTypeKey = backendTypeIriToKey(backend.backendType) ?? 'http';
  if (backendTypeKey !== 'http') {
    throw new PrefixServiceError('Prefix sync applies to HTTP backends only', 409);
  }
  const endpoint = (backend.endpoint ?? '').trim();
  if (!endpoint) {
    throw new PrefixServiceError('This backend has no endpoint URL configured', 409);
  }
  return { endpoint, authEnvKey: backend.authEnvKey ?? null };
}

const usageGroupSchema = {
  type: 'object',
  properties: {
    count: { type: 'number' },
    sample: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    },
  },
} as const;

type UsageGroup = { count: number; sample: Array<{ id: string; name: string }> };
type BackendUsage = {
  queries: UsageGroup;
  queryGroups: UsageGroup;
  benchmarks: UsageGroup;
  libraries: UsageGroup;
};

/** First few names, because a delete or detach warning that only counts is not actionable. */
const USAGE_SAMPLE_SIZE = 5;

function toUsageGroup(entities: Array<{ $id: string; name?: string | null }>): UsageGroup {
  return {
    count: entities.length,
    sample: entities.slice(0, USAGE_SAMPLE_SIZE).map((entity) => ({
      id: entity.$id,
      name: entity.name ?? entity.$id,
    })),
  };
}

/**
 * Everything that points at a backend.
 *
 * Queries and libraries name one directly. A query group does not: its nodes
 * do, one node at a time, so a group counts when its current version holds a
 * node aimed here. Benchmarks name backends inside
 * `subjectSpecs`, which is stored as a JSON string.
 */
function collectBackendUsage(repos: EntityRepositories, backendId: string): BackendUsage {
  const queries = repos.Query.list().filter((query) => query.defaultBackend === backendId);
  const libraries = repos.Library.list().filter((library) => library.defaultBackend === backendId);

  const nodeIds = new Set<string>();
  for (const node of repos.QueryNode.list()) {
    if (node.backendId === backendId) nodeIds.add(node.$id);
  }
  for (const node of repos.DynamicQueryNode.list()) {
    if (node.backendId === backendId) nodeIds.add(node.$id);
  }
  const queryGroups = repos.QueryGroup.list().filter((group) => {
    if (!group.currentVersion) return false;
    const version = repos.QueryGroupVersion.get(group.currentVersion);
    return (version?.executionNodes ?? []).some((nodeId: string) => nodeIds.has(nodeId));
  });

  const benchmarks = repos.BenchmarkExperiment.list().filter((experiment) => {
    if (!experiment.currentVersion) return false;
    const version = repos.BenchmarkExperimentVersion.get(experiment.currentVersion);
    const specs = version?.subjectSpecs;
    if (typeof specs !== 'string') return false;
    try {
      return (JSON.parse(specs) as Array<{ backends?: string[] }>)
        .some((spec) => (spec.backends ?? []).includes(backendId));
    } catch {
      // A version we cannot parse is not a version that names this backend.
      return false;
    }
  });

  return {
    queries: toUsageGroup(queries),
    queryGroups: toUsageGroup(queryGroups),
    benchmarks: toUsageGroup(benchmarks),
    libraries: toUsageGroup(libraries),
  };
}

function buildUpdateBackendPayload(input: BackendUpdate): Partial<LdkitBackend> {
  const {
    endpoint,
    authEnvKey,
    oxigraphConfig,
    name,
    description,
    backendType,
  } = input;

  const payload: Partial<LdkitBackend> = {};

  if (name !== undefined) {
    payload.name = name;
  }
  if (description !== undefined) {
    payload.description = description;
  }
  if (backendType !== undefined) {
    const backendTypeKey = backendTypeIriToKey(backendType);
    if (!backendTypeKey) {
      throw new BackendPayloadError(`Unsupported backend type: ${backendType}`);
    }
    payload.backendType = backendTypeKeyToIri(backendTypeKey);
  }
  if (endpoint !== undefined && endpoint !== null) {
    payload.endpoint = endpoint;
  }
  if (authEnvKey !== undefined) {
    if (authEnvKey === null) {
      payload.authEnvKey = null;
    } else {
      const normalizedKey = normalizeAuthEnvKey(authEnvKey);
      payload.authEnvKey = normalizedKey ?? null;
    }
  }

  const mappedConfig = mapOxigraphConfig(oxigraphConfig);
  if (mappedConfig !== undefined) {
    validateOxigraphMemoryConfig(
      backendType !== undefined ? backendTypeIriToKey(backendType) : undefined,
      mappedConfig.config,
    );
    payload.oxigraphConfig = mappedConfig.stored;
  }

  return payload;
}

export default async function (
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  ensureBackendSchemaRegistered(fastify);


  // --- GET / ---
  // Retrieves all Backend entities using memory cache
  fastify.get<{ Reply: Backend[] | ErrorResponse }>(
    '/',
    ...reposRoute(getBackendsSchema,
    async ({ repos, reply, request }) => {
      // Use memory cache for fast reads
      const ldkitBackends = repos.Backend.list() as LdkitBackend[];
      // Backends are infrastructure: a caller sees the ones they hold a grant on
      // (which includes anything granted to the authenticated sentinel).
      const context = authOf(request);
      const visible = context.fullAccess || context.grants.admin
        ? ldkitBackends
        : ldkitBackends.filter(backend => context.grants.backends.has(backend.$id));
      request.log.info(`Successfully fetched ${visible.length} backends from cache`);
      return reply.send(visible.map(serializeBackend));
    })
  );

  // --- GET /:id ---
  // Retrieves a single Backend by its ID using memory cache
  fastify.get<{ Reply: Backend | ErrorResponse }>(
    '/:id',
    ...reposRoute(getBackendSchema,
    async ({ repos, reply, request }) => {
      const { id: rawId } = request.params;
      requireBackendMode(request, decodeURIComponent(rawId), 'use');
      const id = decodeURIComponent(rawId);

      // Use memory cache for fast lookup
      const ldkitBackend = repos.Backend.get(id) as LdkitBackend | null;

      if (!ldkitBackend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      const payload = serializeBackend(ldkitBackend);
      setEntityConcurrencyHeaders(reply, payload);
      return reply.send(payload);
    })
  );

  // --- POST / ---
  // Creates a new Backend using write-through cache
  fastify.post<{ Body: BackendCreate; Reply: Backend | ErrorResponse }>(
    '/',
    ...reposRoute(createBackendSchema,
    async ({ repos, reply, request }) => {
      // Backend config names the env keys holding service credentials —
      // operator territory, not something a library owner may add.
      requireAdmin(request, 'creating backends');

      const body = request.body;
      const generatedId = body.id ?? mintId('backend');
      let backendData: Partial<LdkitBackend> & { $id: string };
      try {
        backendData = buildCreateBackendPayload(body, generatedId);
      } catch (error) {
        if (error instanceof BackendPayloadError) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }

      // Use write-through cache for consistency and performance
      const createdLdkitBackend = await repos.Backend.create(backendData);

      const payload = serializeBackend(createdLdkitBackend);
      setEntityConcurrencyHeaders(reply, payload);
      return reply.status(201).send(payload);
    })
  );

  // --- PUT /:id ---
  // Updates an existing Backend using write-through cache
  fastify.put<{ Reply: Backend | ErrorResponse }>(
    '/:id',
    ...reposRoute(updateBackendSchema,
    async ({ repos, reply, request }) => {
      requireAdmin(request, 'updating backends');
      const { id: rawId } = request.params;
      const id = decodeURIComponent(rawId);
      let updateData: Partial<LdkitBackend>;
      try {
        updateData = buildUpdateBackendPayload(request.body);
      } catch (error) {
        if (error instanceof BackendPayloadError) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }

      const current = repos.Backend.get(id) as LdkitBackend | null;
      if (!current) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      const { valid, currentTag } = validateIfMatch(request, current);
      if (!valid) {
        return reply.status(412).send({
          error: 'Precondition Failed',
          expected: currentTag,
          current: toRestApi<any>(current),
        });
      }

      // Use write-through cache for consistency and performance
      const updatedLdkitBackend = await repos.Backend.update(id, updateData);

      if (!updatedLdkitBackend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      // A built in-process store was hydrated from the *previous* config, so a
      // change to its sources or mode leaves it serving data the backend no
      // longer describes. Dropping it here makes the edit take effect on next
      // use rather than at the next restart; a durable store is serialized
      // before being dropped, so nothing written to it is lost.
      if (updateData.oxigraphConfig !== undefined || updateData.backendType !== undefined) {
        await oxigraphStoreManager.invalidateMemoryStore(id);
      }

      const payload = serializeBackend(updatedLdkitBackend);
      setEntityConcurrencyHeaders(reply, payload);
      return reply.send(payload);
    })
  );

  // --- GET /probes ---
  // The cached probe results, so the sidebar can draw its health dots without
  // making six network round trips every time the section opens.
  fastify.get<{ Reply: { probes: BackendProbeResult[] } | ErrorResponse }>(
    '/probes',
    ...reposRoute({
        response: {
          200: {
            type: 'object',
            properties: { probes: { type: 'array', items: probeResponseSchema } },
          },
        },
    }, async ({ repos, reply, request }) => {
      const visible = visibleBackends(repos, request);
      return reply.send({ probes: listProbeResults(visible.map((backend) => backend.$id)) });
    })
  );

  // --- POST /probes ---
  // `Probe all` in the sidebar footer.
  fastify.post<{ Reply: { probes: BackendProbeResult[] } | ErrorResponse }>(
    '/probes',
    ...reposRoute({
        response: {
          200: {
            type: 'object',
            properties: { probes: { type: 'array', items: probeResponseSchema } },
          },
        },
    }, async ({ repos, reply, request }) => {
      const targets = visibleBackends(repos, request).map(toProbeTarget);
      const probes = await probeBackends(targets);
      request.log.info(`Probed ${probes.length} backends`);
      return reply.send({ probes });
    })
  );

  // --- POST /:id/probe ---
  // `Test connection`, and what creation runs once against a new backend.
  fastify.post<{ Reply: BackendProbeResult | ErrorResponse }>(
    '/:id/probe',
    ...reposRoute({
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: { 200: probeResponseSchema },
    }, async ({ repos, reply, request }) => {
      const id = decodeURIComponent(request.params.id);
      requireBackendMode(request, id, 'use');

      const backend = repos.Backend.get(id) as LdkitBackend | null;
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      return reply.send(await probeBackend(toProbeTarget(backend)));
    })
  );

  // --- GET /:id/probe-history ---
  // What the health card's `Probe history` shows: the last few observations,
  // newest first, so a flapping backend is distinguishable from a newly
  // broken one.
  fastify.get<{ Reply: { probes: BackendProbeResult[] } | ErrorResponse }>(
    '/:id/probe-history',
    ...reposRoute({
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: { probes: { type: 'array', items: probeResponseSchema } },
          },
        },
    }, async ({ repos, reply, request }) => {
      const id = decodeURIComponent(request.params.id);
      requireBackendMode(request, id, 'use');

      if (!repos.Backend.get(id)) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      return reply.send({ probes: listProbeHistory(id) });
    })
  );

  // --- GET /:id/prefixes ---
  // The prefix map the store itself holds, for the prefix manager's sync
  // dialog to diff local mappings against. Reading someone's prefix map is a
  // read of the backend, so `use` is the bar — the same one `Test connection`
  // clears.
  fastify.get<{ Reply: RemotePrefixesReply | ErrorResponse }>(
    '/:id/prefixes',
    ...reposRoute({
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              mappings: { type: 'array', items: prefixPairSchema },
              source: { type: 'string' },
              readOnly: { type: 'boolean' },
              endpoint: { type: ['string', 'null'] },
            },
          },
        },
    }, async ({ repos, reply, request }) => {
      const id = decodeURIComponent(request.params.id);
      requireBackendMode(request, id, 'use');

      const backend = repos.Backend.get(id) as LdkitBackend | null;
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      try {
        return reply.send(await fetchRemotePrefixes(toPrefixTarget(backend)));
      } catch (error: unknown) {
        if (error instanceof PrefixServiceError) {
          return reply.status(error.status).send({ error: error.message });
        }
        return reply.status(502).send({ error: toError(error).message });
      }
    })
  );

  // --- POST /:id/prefixes ---
  // Push local mappings into the store's own prefix map. This mutates someone
  // else's dataset configuration, so it takes `write` on the backend rather
  // than the `use` its sibling GET takes.
  //
  // Fuseki's prefix service is one call per prefix with no transaction across
  // them, so the reply is per item: a batch can land half-applied, and saying
  // so is more useful than a single status that has to lie about one half or
  // the other.
  fastify.post<{ Reply: PrefixPushReply | ErrorResponse }>(
    '/:id/prefixes',
    ...reposRoute({
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            upserts: { type: 'array', items: prefixPairSchema, maxItems: PREFIX_BATCH_LIMIT },
            deletes: { type: 'array', items: { type: 'string' }, maxItems: PREFIX_BATCH_LIMIT },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    prefix: { type: 'string' },
                    action: { type: 'string' },
                    status: { type: 'string' },
                    error: { type: 'string' },
                  },
                },
              },
              applied: { type: 'number' },
              failed: { type: 'number' },
            },
          },
        },
    }, async ({ repos, reply, request }) => {
      const id = decodeURIComponent(request.params.id);
      requireBackendMode(request, id, 'write');

      const backend = repos.Backend.get(id) as LdkitBackend | null;
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      const body = (request.body ?? {}) as Partial<PrefixBatch>;
      const batch: PrefixBatch = {
        upserts: body.upserts ?? [],
        deletes: body.deletes ?? [],
      };

      try {
        const results = await pushPrefixes(toPrefixTarget(backend), batch);
        return reply.send({
          results,
          applied: results.filter((result) => result.status === 'ok').length,
          failed: results.filter((result) => result.status === 'failed').length,
        });
      } catch (error: unknown) {
        if (error instanceof PrefixServiceError) {
          return reply.status(error.status).send({ error: error.message });
        }
        return reply.status(502).send({ error: toError(error).message });
      }
    })
  );

  // --- GET /:id/env ---
  // The three SQLIB_BACKEND_* variables and whether each is set on this
  // runner. Presence only — a value never leaves the process (doc §Object).
  fastify.get<{
    Reply: { authEnvKey: string | null; variables: Array<{ name: string; role: string; set: boolean }> } | ErrorResponse
  }>(
    '/:id/env',
    ...reposRoute({
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              authEnvKey: { type: ['string', 'null'] },
              variables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    role: { type: 'string' },
                    set: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
    }, async ({ repos, reply, request }) => {
      // Which variables a backend reads is operator territory, the same scope
      // that may edit the key itself.
      requireAdmin(request, 'reading backend environment variables');
      const id = decodeURIComponent(request.params.id);

      const backend = repos.Backend.get(id) as LdkitBackend | null;
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      const names = buildBackendAuthEnvVarNames(backend.authEnvKey);
      if (!names) {
        return reply.send({ authEnvKey: null, variables: [] });
      }

      const isSet = (name: string) => typeof process.env[name] === 'string' && process.env[name]!.length > 0;
      return reply.send({
        authEnvKey: names.key,
        variables: [
          { name: names.username, role: 'Basic auth username', set: isSet(names.username) },
          { name: names.password, role: 'Basic auth password', set: isSet(names.password) },
          { name: names.authHeader, role: 'Authorization header override', set: isSet(names.authHeader) },
        ],
      });
    })
  );

  // --- GET /:id/usage ---
  // What points at this backend, for the record page's Used by tiles.
  //
  // Rule sets are absent on purpose rather than reported as zero: nothing in
  // the rule-set model names a backend, so a tile would be a fact about the
  // schema dressed up as a fact about this connection.
  fastify.get<{ Reply: BackendUsage | ErrorResponse }>(
    '/:id/usage',
    ...reposRoute({
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              queries: usageGroupSchema,
              queryGroups: usageGroupSchema,
              benchmarks: usageGroupSchema,
              libraries: usageGroupSchema,
            },
          },
        },
    }, async ({ repos, reply, request }) => {
      const id = decodeURIComponent(request.params.id);
      requireBackendMode(request, id, 'use');

      if (!repos.Backend.get(id)) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      return reply.send(collectBackendUsage(repos, id));
    })
  );

  // --- GET /:id/references ---
  // Get all entities that reference this backend as their defaultBackend.
  //
  // The same question `/:id/usage` above answers, over two of the same four
  // collections, and it took no check at all until 2026-09-14: a principal
  // holding no grant on the backend was answered 200 with the id and name of
  // every library and query in the deployment pointing at it. `use` is the bar
  // its sibling sets, and this is the same read of the same connection.
  fastify.get<{
    Reply: { libraries: Array<{ id: string; name: string }>; queries: Array<{ id: string; name: string }> } | ErrorResponse
  }>(
    '/:id/references',
    ...reposRoute({
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          },
          required: ['id']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              libraries: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' }
                  }
                }
              },
              queries: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' }
                  }
                }
              }
            }
          }
        }
    }, async ({ repos, reply, request }) => {
      const { id: rawId } = request.params;
      const id = decodeURIComponent(rawId);
      requireBackendMode(request, id, 'use');

      // Check if backend exists
      const backend = repos.Backend.get(id);
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      // Find all Libraries that reference this backend
      const libraries = repos.Library.list();
      const referencingLibraries = libraries
        .filter(lib => lib.defaultBackend === id)
        .map(lib => ({ id: lib.$id, name: lib.name }));

      // Find all Queries that reference this backend
      const queries = repos.Query.list();
      const referencingQueries = queries
        .filter(query => query.defaultBackend === id)
        .map(query => ({ id: query.$id, name: query.name }));

      return reply.send({
        libraries: referencingLibraries,
        queries: referencingQueries,
      });
    })
  );

  // --- DELETE /:id ---
  // Deletes a Backend using write-through cache
  // Also clears any defaultBackend references in Libraries and Queries
  fastify.delete<{ Reply: { error: string } | null }>(
    '/:id',
    ...reposRoute(deleteBackendSchema,
    async ({ repos, reply, request }) => {
      requireAdmin(request, 'deleting backends');
      const { id: rawId } = request.params;
      const id = decodeURIComponent(rawId);

      // Check if backend exists
      const backend = repos.Backend.get(id);
      if (!backend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      // Find and update all Libraries that reference this backend
      const libraries = repos.Library.list();
      for (const library of libraries) {
        if (library.defaultBackend === id) {
          request.log.info(`Clearing defaultBackend reference in Library: ${library.$id}`);
          await repos.Library.update(library.$id, { defaultBackend: null });
        }
      }

      // Find and update all Queries that reference this backend
      const queries = repos.Query.list();
      for (const query of queries) {
        if (query.defaultBackend === id) {
          request.log.info(`Clearing defaultBackend reference in Query: ${query.$id}`);
          await repos.Query.update(query.$id, { defaultBackend: null });
        }
      }

      // Use write-through cache for consistency and performance
      await repos.Backend.delete(id);
      // Otherwise a re-created backend that reuses this id inherits a dot
      // describing a store that no longer exists.
      forgetProbeResult(id);
      // Same reasoning for the store itself: a deleted backend's in-process
      // store must not outlive it and be inherited by the next backend minted
      // with this id.
      await oxigraphStoreManager.invalidateMemoryStore(id);

      return reply.status(204).send();
    })
  );

  // --- POST /:id/upload ---
  // Upload data file to an oxigraph backend
  fastify.post<{
    Body: { format?: string };
    Reply: { message: string; stats?: unknown } | { error: string }
  }>(
    '/:id/upload',
    ...reposRoute({
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          },
          required: ['id']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              stats: { type: 'object' }
            }
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' }
            }
          }
        }
    }, async ({ repos, reply, request }) => {
      const { id: rawId } = request.params;
      const id = decodeURIComponent(rawId);
      // Above the lookup, not below it: see the note on `GET /:id/stats`.
      requireBackendMode(request, id, 'write');

      // Get backend from cache
      const ldkitBackend = repos.Backend.get(id) as LdkitBackend | null;
      if (!ldkitBackend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      // Verify it's an oxigraph backend
      const backendTypeKey = backendTypeIriToKey(ldkitBackend.backendType);
      if (backendTypeKey !== 'oxigraphEphemeral' && backendTypeKey !== 'oxigraphMemory') {
        return reply.status(400).send({ error: 'Backend is not an in-process oxigraph backend' });
      }

      // An upload is a write, so it meets the same rule SPARQL Update does: a
      // read-only store is rebuilt from its data graphs, and content loaded
      // into one would disappear at the next reload. Refusing is the honest
      // answer — see `ReadOnlySparqlExecutor` for the same reasoning.
      const storedConfig = resolveOxigraphConfig(ldkitBackend.oxigraphConfig, id);
      const storeMode = storedConfig?.mode ?? 'readOnly';
      if (backendTypeKey === 'oxigraphMemory' && storeMode === 'readOnly') {
        return reply.status(403).send({
          error: `Backend ${id} is read-only: it is hydrated from data graphs, so uploaded data would be discarded on the next reload. Upload to the underlying data graph instead.`,
        });
      }

      // Handle file upload
      const data: MultipartFile | undefined = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      try {
        const buffer = await data.toBuffer();
        // Not inferable: this is a multipart upload, so `request.body` is
        // assembled by @fastify/multipart from the form fields rather than
        // validated against a body schema — the route declares none.
        const body = (request.body as { format?: string }) ?? {};
        const format = body.format ||
          data.filename?.split('.').pop()?.toLowerCase() ||
          'turtle';

        // Get or create the store
        const store = backendTypeKey === 'oxigraphMemory'
          ? (oxigraphStoreManager.getMemoryStore(id)
            ?? await oxigraphStoreManager.createMemoryStore(
              id,
              storedConfig ?? { storeType: 'ephemeral', mode: storeMode },
            ))
          : (oxigraphStoreManager.getEphemeralStore(id)
            || oxigraphStoreManager.createEphemeralStore(id));

        // Load the data
        const content = buffer.toString('utf8');
        await oxigraphStoreManager.loadDataFromString(store, content, format);

        // Get updated stats
        const stats = oxigraphStoreManager.getStoreStats(id);

        request.log.info(`Successfully uploaded data to backend ${id} (format: ${format})`);
        return reply.send({
          message: 'Data uploaded successfully',
          stats: stats
        });
      } catch (error__u: unknown) {
      const error = toError(error__u);
        request.log.error(error, `Failed to upload data to backend: ${rawId}`);
        throw Object.assign(
          new Error(error?.message || 'Failed to upload data'),
          { statusCode: error?.statusCode ?? 500 }
        );
      }
    })
  );

  // --- GET /:id/stats ---
  // Get statistics for an oxigraph backend
  fastify.get<{
    Reply: { stats: unknown } | { error: string }
  }>(
    '/:id/stats',
    ...reposRoute({
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          },
          required: ['id']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              stats: { type: 'object' }
            }
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' }
            }
          }
        }
    }, async ({ repos, reply, request }) => {
      const { id: rawId } = request.params;
      const id = decodeURIComponent(rawId);
      /*
       * Above the lookup and above the type test, which is where every other
       * route in this plugin puts it and where these three did not until
       * 2026-09-14. Checking last does not make an unauthorized caller's
       * request succeed, but it answers three different ways before refusing:
       * 404 for an id that is not stored, 400 for one that is stored and is
       * not an in-process store, 403 for one that is both. So a principal
       * holding nothing could enumerate which backend ids exist and which of
       * them hold their data in this process — which is the set worth
       * uploading to, clearing, or asking for statistics about.
       */
      requireBackendMode(request, id, 'use');

      // Get backend from cache
      const ldkitBackend = repos.Backend.get(id) as LdkitBackend | null;
      if (!ldkitBackend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      // Verify it's an oxigraph backend
      const backendTypeKey = backendTypeIriToKey(ldkitBackend.backendType);
      if (backendTypeKey !== 'oxigraphEphemeral' && backendTypeKey !== 'oxigraphMemory') {
        return reply.status(400).send({ error: 'Backend is not an in-process oxigraph backend' });
      }

      // Reading stats is not a write, so it applies to every in-process store
      // whatever its mode.
      const stats = oxigraphStoreManager.getStoreStats(id);
      if (!stats) {
        return reply.status(404).send({ error: 'Store not found or not loaded' });
      }

      return reply.send({ stats });
    })
  );

  // --- DELETE /:id/data ---
  // Clear all data from an oxigraph backend
  fastify.delete<{
    Reply: { message: string } | { error: string }
  }>(
    '/:id/data',
    ...reposRoute({
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          },
          required: ['id']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' }
            }
          }
        }
    }, async ({ repos, reply, request }) => {
      const { id: rawId } = request.params;
      const id = decodeURIComponent(rawId);
      // Above the lookup, not below it: see the note on `GET /:id/stats`.
      requireBackendMode(request, id, 'write');

      // Get backend from cache
      const ldkitBackend = repos.Backend.get(id) as LdkitBackend | null;
      if (!ldkitBackend) {
        return reply.status(404).send({ error: 'Backend not found' });
      }

      // Verify it's an oxigraph backend
      const backendTypeKey = backendTypeIriToKey(ldkitBackend.backendType);
      if (backendTypeKey !== 'oxigraphEphemeral' && backendTypeKey !== 'oxigraphMemory') {
        return reply.status(400).send({ error: 'Backend is not an in-process oxigraph backend' });
      }

      // Clearing is a write, so a read-only store refuses it for the same
      // reason it refuses an update: the next reload would undo it anyway.
      const clearMode = resolveOxigraphConfig(ldkitBackend.oxigraphConfig, id)?.mode ?? 'readOnly';
      if (backendTypeKey === 'oxigraphMemory' && clearMode === 'readOnly') {
        return reply.status(403).send({
          error: `Backend ${id} is read-only: it is hydrated from data graphs, so clearing it would be undone on the next reload.`,
        });
      }

      const store = backendTypeKey === 'oxigraphMemory'
        ? oxigraphStoreManager.getMemoryStore(id)
        : oxigraphStoreManager.getEphemeralStore(id);
      if (!store) {
        return reply.status(404).send({ error: 'Store not found' });
      }

      // Clear all data using SPARQL UPDATE
      store.update('DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }');
      // Reaching the store directly rather than through an executor, so the
      // clear says so itself: a durable memory backend cleared here and then
      // left alone would otherwise be skipped by the next checkpoint, and the
      // snapshot on disk would still hold everything that was cleared (#443).
      markStoreWritten(store);

      request.log.info(`Cleared all data from backend ${id}`);
      return reply.send({ message: 'All data cleared successfully' });
    })
  );

  /**
   * `GET /backends/:id/patches` — the write log for one backend.
   *
   * Newest first, because the questions asked of a log are "what just
   * happened" and "what do I undo", and both live at the head. It is honest
   * about being sqlib's view: a writer that reached the store some other way
   * left no patch here, and the log never claims otherwise.
   */
  fastify.get(
    '/:id/patches',
    ...reposRoute({
      tags: ['Backend'],
      summary: 'List patches applied to a backend',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          since: { type: 'string' },
          graph: { type: 'string' },
          source: { type: 'string' },
          status: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
        },
        additionalProperties: false,
      },
      response: {
        200: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
    }, async ({ repos, reply, request }) => {
      const backendId = decodeURIComponent(request.params.id);
      requireBackendMode(request, backendId, 'use');

      const { since, graph, source, status, limit } = request.query;
      const sinceMs = since ? Date.parse(since) : NaN;

      const patches = repos.Patch.list()
        .filter((patch) => patch.isPartOf === backendId)
        .filter((patch) => (status ? patch.patchStatus === status : true))
        .filter((patch) => (source ? patch.sourceKind === source : true))
        .filter((patch) => (graph ? (patch.graphScope ?? []).includes(graph) : true))
        .filter((patch) => {
          if (!Number.isFinite(sinceMs)) return true;
          const created = patch.dateCreated ? Date.parse(patch.dateCreated) : NaN;
          return Number.isFinite(created) && created >= sinceMs;
        })
        .sort((left, right) => (right.dateCreated ?? '').localeCompare(left.dateCreated ?? ''));

      return reply.send(patches.slice(0, limit ?? 50).map(toPatchView));
    })
  );

  /**
   * `GET /backends/:id/patch-log` — the same log, folded rather than listed.
   *
   * `/patches` answers "what happened"; this answers "what did it add up to".
   * The fold is done in DuckDB against the SQL POC-2 measured, in a database
   * created for the request and closed with it — see `PatchLogService` for why
   * it is not the ETL instance.
   *
   * It is honest about what it cannot know. A log with no total order, a patch
   * with no date, blank nodes that no label identifies across patches: each is
   * a `caveats` entry beside the answer rather than a refusal to give one.
   */
  fastify.get(
    '/:id/patch-log',
    ...reposRoute({
      tags: ['Backend'],
      summary: 'Reconstruct or analyse a backend patch log',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          asOf: { type: 'string', description: 'Patch IRI to travel to. Omitted means the head of the log.' },
          state: { type: 'boolean', default: true },
          nquads: { type: 'boolean', default: false },
          churn: { type: 'boolean', default: false },
          hotQuads: { type: 'integer', minimum: 1, maximum: 500 },
        },
        additionalProperties: false,
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', additionalProperties: true },
        503: { type: 'object', additionalProperties: true },
      },
    }, async ({ repos, reply, request }) => {
      const backendId = decodeURIComponent(request.params.id);
      requireBackendMode(request, backendId, 'use');

      const { asOf, state = true, nquads = false, churn = false, hotQuads } = request.query;

      const patches = repos.Patch.list()
        .filter((patch) => patch.isPartOf === backendId)
        .filter((patch) => PATCH_LOG_STATUSES.has(patch.patchStatus));

      const { rows, patchIds, caveats } = buildPatchLog(patches);

      let asOfOrdinal: number | undefined;
      if (asOf !== undefined) {
        const wanted = decodeURIComponent(asOf);
        const index = patchIds.indexOf(wanted);
        if (index === -1) {
          return reply.code(400).send({
            error: `Patch ${wanted} is not in this backend's log. Only applied and reverted patches are.`,
          });
        }
        asOfOrdinal = index + 1;
      }

      const body: Record<string, unknown> = {
        backend: backendId,
        patchCount: patchIds.length,
        rowCount: rows.length,
        order: patchIds,
        caveats,
      };

      if (!state && !churn && hotQuads === undefined) {
        return reply.send(body);
      }

      try {
        const analysis = await patchLogService.analyse(rows, {
          ...(state ? { state: { asOf: asOfOrdinal, nquads } } : {}),
          ...(churn ? { churn: true } : {}),
          ...(hotQuads === undefined ? {} : { hotQuads: { limit: hotQuads } }),
        });
        if (analysis.quadCount !== undefined) {
          body.state = {
            asOf: asOf === undefined ? null : decodeURIComponent(asOf),
            quadCount: analysis.quadCount,
            ...(analysis.nquads === undefined ? {} : { nquads: analysis.nquads.join('\n') }),
          };
        }
        if (analysis.churn) body.churn = analysis.churn;
        if (analysis.hotQuads) body.hotQuads = analysis.hotQuads;
        return reply.send(body);
      } catch (error__u: unknown) {
        if (error__u instanceof PatchLogUnavailableError) {
          return reply.code(503).send({ error: error__u.message });
        }
        throw error__u;
      }
    })
  );

}
