/**
 * HTTP caching for a run whose every input is pinned (#206).
 *
 * `GET /execute` and `GET /substitute` normally answer `Cache-Control:
 * no-store` (`httpCaching.ts`). A response can be reused when nothing it
 * depends on can change:
 *
 * 1. The target is a query version, which is immutable. A query names its
 *    current version, which moves.
 * 2. Each argument set is named by version. Inline arguments are refused here,
 *    to keep the rule the same as for a stored run.
 * 3. For `/execute`, the backend's data has a version sqlib knows: an
 *    `oxigraphMemory` backend in `readOnly` mode whose every source names a
 *    data-graph version. A live HTTP endpoint or a writable store does not.
 *
 * The ETag is a hash of those pins, the rest of the request, the negotiated
 * media type and the caller. It is computed before anything runs, so
 * `If-None-Match` can answer `304` without executing.
 *
 * Shared caches: `public, immutable` only where every caller gets the same
 * answer (`disabled` mode, or a guest in `anonymous` mode). Elsewhere
 * `private, no-cache`: a shared cache in front of the auth check does not store
 * it, and a browser asks again on each use. The caller can come from a cookie
 * that a sign-in proxy turns into a header, which `Vary` cannot name, so a
 * browser must not reuse one person's result for the next person who signs in.
 * The ETag is per caller, so the repeat request still gets `304` without
 * running.
 */
import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authOf } from '../auth/enforce.js';
import { PRINCIPAL_ANONYMOUS } from '../auth/types.js';
import { backendTypeIriToKey, resolveOxigraphConfig, type PersistedBackend } from '../persistence/schemas/BackendSchema.js';
import { QueryTypeIri } from '../constants/queryTypes.js';

/** A year, the longest lifetime RFC 9111 caches are asked to honour. */
export const PINNED_MAX_AGE_SECONDS = 31_536_000;

/** Reads an entity by id; `getCacheCoordinator().get` in the server. */
export type EntityLookup = (id: string) => unknown;

interface Typed {
  '@type'?: unknown;
  $id?: unknown;
  queryType?: unknown;
}

function typeOf(entity: unknown): string | undefined {
  const value = (entity as Typed | null | undefined)?.['@type'];
  return typeof value === 'string' ? value : undefined;
}

/** The pins a request resolved to, or the reason it is not pinned. */
export type PinResult = { pinned: true; pins: Record<string, unknown> } | { pinned: false; reason: string };

/** Pins 1 and 2: the query version and the argument-set versions. */
export function pinQueryAndArguments(
  lookup: EntityLookup,
  input: { targetId?: string; argumentSetIds?: readonly string[]; inlineArguments?: unknown },
): PinResult {
  if (!input.targetId) return { pinned: false, reason: 'no target' };
  const target = lookup(input.targetId);
  if (typeOf(target) !== 'QueryVersion') return { pinned: false, reason: 'target is not a query version' };
  if ((target as Typed).queryType === QueryTypeIri.update) return { pinned: false, reason: 'update' };
  if (Array.isArray(input.inlineArguments) && input.inlineArguments.length > 0) {
    return { pinned: false, reason: 'inline arguments' };
  }
  for (const id of input.argumentSetIds ?? []) {
    if (typeOf(lookup(id)) !== 'ArgumentSetVersion') {
      return { pinned: false, reason: `argument set ${id} is not a version` };
    }
  }
  return { pinned: true, pins: { target: input.targetId, argumentSets: [...(input.argumentSetIds ?? [])] } };
}

/** Pin 3: the data-graph versions a backend loads, or why its data is not pinned. */
export function pinBackendData(lookup: EntityLookup, backendId: string | undefined): PinResult {
  if (!backendId) return { pinned: false, reason: 'no backend' };
  const backend = lookup(backendId) as PersistedBackend | null;
  if (!backend || typeOf(backend) !== 'Backend') return { pinned: false, reason: 'backend not found' };
  if (backendTypeIriToKey(String(backend.backendType)) !== 'oxigraphMemory') {
    return { pinned: false, reason: 'backend is not an in-process store' };
  }
  // A graph policy reads grants, which change without a version.
  if (backend.graphPolicyQueryVersion) return { pinned: false, reason: 'graph policy' };
  let config;
  try {
    config = resolveOxigraphConfig(backend.oxigraphConfig, backendId);
  } catch {
    return { pinned: false, reason: 'unreadable store config' };
  }
  if (!config) return { pinned: false, reason: 'no store config' };
  if ((config.mode ?? 'readOnly') !== 'readOnly') return { pinned: false, reason: 'writable store' };
  if (config.loadMethod && config.loadMethod !== 'none') return { pinned: false, reason: 'external load' };
  const sources = config.sources ?? [];
  const versions: Array<{ version: string; namedGraph: string | null }> = [];
  for (const source of sources) {
    if (!source.dataGraphVersionId) return { pinned: false, reason: 'a source tracks a data graph' };
    versions.push({ version: source.dataGraphVersionId, namedGraph: source.namedGraph ?? null });
  }
  return { pinned: true, pins: { backend: backendId, dataGraphVersions: versions } };
}

/**
 * Who the answer is for. Only callers who are all treated alike share a
 * `public` response; everyone else gets `private` and their own ETag.
 */
export function cacheAudience(request: FastifyRequest): { scope: 'public' | 'private'; caller: string } {
  const context = authOf(request);
  if (context.mode === 'disabled') return { scope: 'public', caller: 'everyone' };
  if (context.mode === 'anonymous' && context.subject === PRINCIPAL_ANONYMOUS) {
    return { scope: 'public', caller: PRINCIPAL_ANONYMOUS };
  }
  return { scope: 'private', caller: [...context.principals].sort().join(' ') };
}

/** A strong ETag over everything a pinned response depends on. */
export function pinnedEtag(parts: Record<string, unknown>): string {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest('base64url');
  return `"p1-${digest}"`;
}

/** True when `If-None-Match` names this ETag (or `*`). */
export function matchesIfNoneMatch(header: string | string[] | undefined, etag: string): boolean {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return false;
  return raw
    .split(',')
    .map(part => part.trim().replace(/^W\//, ''))
    .some(tag => tag === '*' || tag === etag);
}

/** The headers a pinned response carries. */
export function setPinnedHeaders(reply: FastifyReply, etag: string, scope: 'public' | 'private'): void {
  reply.header('ETag', etag);
  reply.header(
    'Cache-Control',
    scope === 'public' ? `public, max-age=${PINNED_MAX_AGE_SECONDS}, immutable` : 'private, no-cache'
  );
  reply.header('Vary', 'Accept, Authorization');
}

const pinnedReplies = new WeakMap<FastifyRequest, { etag: string; scope: 'public' | 'private' }>();

/** Marks a request whose successful response may be cached under `etag`. */
export function markPinned(request: FastifyRequest, etag: string, scope: 'public' | 'private'): void {
  pinnedReplies.set(request, { etag, scope });
}

/**
 * The `onSend` half: a marked request that succeeded gets the cache headers.
 * An error keeps `no-store`, so a failure is never cached as the answer.
 */
export function applyPinnedHeaders(request: FastifyRequest, reply: FastifyReply): void {
  const pinned = pinnedReplies.get(request);
  if (!pinned || reply.statusCode !== 200) return;
  setPinnedHeaders(reply, pinned.etag, pinned.scope);
}
