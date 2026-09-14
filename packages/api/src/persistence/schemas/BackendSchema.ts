/**
 * LDKit Schema for Backend Entity
 * 
 * This entity represents SPARQL endpoint configurations.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo, sqlibBackendType, sqlibQueryMethod } from '../namespaces.js';

export const BackendTypeIri = {
  http: sqlibBackendType.http,
  oxigraphEphemeral: sqlibBackendType.oxigraphEphemeral,
  oxigraphMemory: sqlibBackendType.oxigraphMemory,
} as const;

export type BackendTypeKey = keyof typeof BackendTypeIri;
export type BackendTypeValue = typeof BackendTypeIri[BackendTypeKey];

const backendTypeEntries = Object.entries(BackendTypeIri) as Array<[BackendTypeKey, BackendTypeValue]>;
/**
 * Legacy spellings that must keep resolving.
 *
 * Until `oxigraphMemory` existed there was one in-process backend type, so
 * every historical spelling — including the "persistent" ones — was collapsed
 * onto `oxigraphEphemeral`. That collapse is now untangled: "memory" and
 * "persistent" name real, distinct things, so they resolve to `oxigraphMemory`
 * (whose `mode` says which lifecycle is meant) rather than silently meaning
 * "ephemeral". Bare `oxigraphEphemeral` spellings keep their old meaning, which
 * is the one case where the old and new readings agree.
 */
const backendTypeAliasMap: Record<string, BackendTypeKey> = {
  http: 'http',
  oxigraphephemeral: 'oxigraphEphemeral',
  oxigraphephemeralbackend: 'oxigraphEphemeral',
  oxigraphmemory: 'oxigraphMemory',
  oxigraphmemorybackend: 'oxigraphMemory',
  oxigraphpersistent: 'oxigraphMemory',
  oxigraphpersistentbackend: 'oxigraphMemory',
  oxigraphdurable: 'oxigraphMemory',
  httpssparqlquerylibbackendtypeoxigraphpersistent: 'oxigraphMemory',
  httpssparqlquerylibbackendtypeoxigraphmemory: 'oxigraphMemory',
};

function normalizeBackendTypeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z]/g, '');
}

function resolveBackendTypeKey(value: string): BackendTypeKey | undefined {
  const direct = backendTypeEntries.find(([entryKey]) => entryKey === value)?.[0];
  if (direct) return direct;
  const normalized = normalizeBackendTypeKey(value);
  return backendTypeAliasMap[normalized];
}

export function backendTypeKeyToIri(key: BackendTypeKey): BackendTypeValue {
  return BackendTypeIri[key];
}

export function backendTypeIriToKey(iri: string): BackendTypeKey | undefined {
  for (const [key, value] of backendTypeEntries) {
    if (value === iri) {
      return key;
    }
  }
  return resolveBackendTypeKey(iri);
}

export function isBackendTypeIri(value: string): value is BackendTypeValue {
  return backendTypeEntries.some(([, iri]) => iri === value);
}

export function backendTypeKeyToIriSafe(key: string): BackendTypeValue | undefined {
  const resolvedKey = resolveBackendTypeKey(key);
  return resolvedKey ? BackendTypeIri[resolvedKey] : undefined;
}

// Query Method helpers
export const QueryMethodIri = {
  post: sqlibQueryMethod.post,
  get: sqlibQueryMethod.get,
} as const;

export type QueryMethodKey = keyof typeof QueryMethodIri;
export type QueryMethodValue = typeof QueryMethodIri[QueryMethodKey];

const queryMethodEntries = Object.entries(QueryMethodIri) as Array<[QueryMethodKey, QueryMethodValue]>;

export function queryMethodKeyToIri(key: QueryMethodKey): QueryMethodValue {
  return QueryMethodIri[key];
}

export function queryMethodIriToKey(iri: string): QueryMethodKey | undefined {
  return queryMethodEntries.find(([, value]) => value === iri)?.[0];
}

export function isQueryMethodIri(value: string): value is QueryMethodValue {
  return queryMethodEntries.some(([, iri]) => iri === value);
}

export const BackendSchema = {
  '@type': sqlib.Backend,
  name: {
    '@id': sdo.name,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  backendType: {
    '@id': sqlib.backendType,
    '@type': ldkit.IRI,
    // The same map the route handlers translate with, read by the generator so
    // the published contract says `enum: ['http', 'oxigraphEphemeral']` rather
    // than `format: iri` — which is what the wire has always carried.
    '@values': BackendTypeIri,
  },
  endpoint: {
    '@id': sdo.url,
    '@type': xsd.anyURI,
    '@optional': true,
  },
  authEnvKey: {
    '@id': sqlib.authEnvKey,
    '@optional': true,
    '@pattern': '^[A-Z0-9_]+$',
  },
  queryMethod: {
    '@id': sqlib.queryMethod,
    '@type': ldkit.IRI,
    '@values': QueryMethodIri,
    '@optional': true,
  },
  dateCreated: {
    '@id': sdo.dateCreated,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  dateModified: {
    '@id': sdo.dateModified,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  oxigraphConfig: {
    '@id': sqlib.oxigraphConfig,
    '@optional': true,
  },
} as const satisfies Schema;

/**
 * The lifecycle of an in-process (`oxigraphMemory`) store.
 *
 * - `readOnly` — hydrated from data graphs on startup and never written. The
 *   store itself is not enforcing this: Oxigraph's `Store` has no read-only
 *   flag, so the guard lives in `ReadOnlySparqlExecutor`. Without an explicit
 *   guard a "read-only" store would accept an update and then silently revert
 *   it on the next restart, which is worse than an error.
 * - `ephemeral` — seeded the same way, writable, never saved. Scratch space.
 * - `durable` — seeded on first boot only, then serialized to `.nq` under the
 *   store manager's `storageDir`. See `OxigraphDataGraphSource` for why the
 *   seed is not a mirror.
 */
export type OxigraphStoreMode = 'readOnly' | 'ephemeral' | 'durable';

export const OXIGRAPH_STORE_MODES: readonly OxigraphStoreMode[] = ['readOnly', 'ephemeral', 'durable'];

export function isOxigraphStoreMode(value: unknown): value is OxigraphStoreMode {
  return typeof value === 'string' && (OXIGRAPH_STORE_MODES as readonly string[]).includes(value);
}

/**
 * One data graph an in-process store is hydrated from.
 *
 * Exactly one of the two ids is set, and which one decides the sync story:
 *
 * - `dataGraphVersionId` (**pinned**) — a version's content is immutable, so
 *   there is nothing to keep in sync: rehydrating on startup reproduces the
 *   same bytes forever.
 * - `dataGraphId` (**tracked**) — resolved to the graph's `currentVersion` at
 *   load time. Staying in sync is cheap because every data-graph write goes
 *   through this API, so saving a version can invalidate the stores that
 *   track it (`invalidateStoresTrackingDataGraph`). No polling, no diffing.
 *
 * For `durable` stores this is a *seed, not a mirror*: it hydrates the first
 * boot, after which the on-disk `.nq` is the source of truth and drift from
 * the data graph is expected — exactly like a database initialised from seed
 * migrations. Content is never written back to data graphs.
 */
export interface OxigraphDataGraphSource {
  /** Pinned to an immutable version. Mutually exclusive with `dataGraphId`. */
  dataGraphVersionId?: string;
  /** Tracks the graph's head version. Mutually exclusive with `dataGraphVersionId`. */
  dataGraphId?: string;
  /** Optional named graph to load the content into. Defaults to the default graph. */
  namedGraph?: string;
}

export interface OxigraphSourceConfig {
  // For file-based loading
  filePath?: string;
  format?: string; // turtle, ntriples, rdfxml, jsonld
  
  // For remote SPARQL import
  remoteEndpoint?: string;
  importQuery?: string;
  
  // For remote file import
  remoteFileUrl?: string;
}

/**
 * Configuration for Oxigraph stores.
 *
 * IMPORTANT: The oxigraph JavaScript/WebAssembly bindings only support in-memory stores.
 * There is NO RocksDB disk-backed persistence like in Rust/Python bindings.
 *
 * - storeType 'durable': In-memory store serialized to .nq file on shutdown
 * - storeType 'ephemeral': Pure in-memory, never serialized
 *
 * For true disk-backed persistence, run oxigraph-server as a sidecar and use HTTP backend.
 */
export interface OxigraphConfig {
  /**
   * Store type:
   * - 'durable' (preferred) or 'persistent': In-memory, serialized to .nq on shutdown
   * - 'ephemeral': Pure in-memory, never saved
   */
  storeType: 'durable' | 'persistent' | 'ephemeral';
  /**
   * Lifecycle for an `oxigraphMemory` backend. Defaults to `readOnly` — the
   * mode with no hard problems in it, and the one worth defaulting to when a
   * caller registers a store over library data without saying more.
   */
  mode?: OxigraphStoreMode;
  /**
   * Data graphs this store is hydrated from, in order. Empty or absent means
   * an unseeded store.
   */
  sources?: OxigraphDataGraphSource[];
  loadMethod?: 'file' | 'remote-sparql' | 'remote-file' | 'none';
  sourceConfig?: OxigraphSourceConfig;
  /**
   * @deprecated This field is ignored. Oxigraph JS does not support RocksDB paths.
   * Serialization path is determined automatically from storageDir.
   */
  persistPath?: string;
}

export interface LdkitBackend {
  $id: string;
  '@type'?: 'Backend';
  name: string;
  description?: string | null;
  backendType: BackendTypeValue;
  endpoint: string;
  authEnvKey?: string | null;
  queryMethod?: QueryMethodValue | null;
  /**
   * The store configuration, as the JSON string the triple store round-trips.
   *
   * A string rather than a nested structure for the reason `Patch.graphOps`
   * gives: the record is a small closed document read as a whole. The property
   * is not declared `rdf:JSON`, so the serialiser stores whatever it is given
   * verbatim — an object reached it as `String(value)`, the literal
   * `"[object Object]"`, and read back as a config with no sources and no mode
   * (issue #305 in a second place). Declaring the string here is what keeps a
   * write from silently losing the config at the next reload.
   *
   * The object form is still accepted on the way in, because a cache-served
   * read inside the writing process returns the very object that was written.
   * Read it through `resolveOxigraphConfig`, never by reaching for a property.
   */
  oxigraphConfig?: OxigraphConfig | string | null;
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
}

/**
 * A backend's store configuration as an object, whichever form it is held in.
 *
 * The persisted form is a JSON string and the in-process cache may hand back
 * the object that was written, so every read site has to accept both. An
 * unreadable string throws rather than falling back to a default: a config
 * that cannot be read is a backend pointed at nothing, and defaulting would
 * hydrate an empty store and answer queries with zero results — the silent
 * failure that made this worth fixing.
 */
export function resolveOxigraphConfig(
  value: OxigraphConfig | string | null | undefined,
  backendId: string,
): OxigraphConfig | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `Backend ${backendId} has an unreadable oxigraphConfig: ${
          error instanceof Error ? error.message : String(error)
        } (stored value: ${JSON.stringify(trimmed)})`,
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Backend ${backendId} has an oxigraphConfig that is not a JSON object`);
    }
    return parsed as OxigraphConfig;
  }

  return value;
}
