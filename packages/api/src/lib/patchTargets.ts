/**
 * Which store a patch is derived from and applied to.
 *
 * One resolution step, used by preview, apply and revert alike, so that the
 * three can never disagree about what "this backend" means. It deliberately
 * does no authorisation: the routes decide whether the caller may read or write
 * a backend, because preview needs `use` and apply needs `write`, and a
 * resolver that guessed would have to pick one.
 *
 * The distinction that matters is exactness. An in-process Oxigraph backend
 * hands back its store, so derivation gets a membership test that works for
 * blank nodes and application happens through the same store object — the
 * strongest configuration available, and the one the equivalence suite is
 * pinned to. Everything else is reachable only over SPARQL, and says so.
 */

import * as oxigraph from 'oxigraph';
import type { DeltaStore } from '@sparql-query-lib/rdf-delta';
import { EPHEMERAL_BACKEND_ID, LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import { Backends } from '../persistence/utils/BackendUtils.js';
import { backendTypeIriToKey, queryMethodIriToKey, resolveOxigraphConfig } from '../persistence/schemas/BackendSchema.js';
import { resolveBackendEnvAuth } from './backendAuth.js';
import { oxigraphStoreManager } from './OxigraphStoreManager.js';
import { HttpSparqlExecutor } from '../server/HttpSparqlExecutor.js';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import type { ISparqlExecutor } from '../server/ISparqlExecutor.js';
import { executorDeltaStore, oxigraphDeltaStore } from './deltaStore.js';

/** Raised when a backend cannot host patches at all. */
export class PatchTargetError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'PatchTargetError';
    this.statusCode = statusCode;
  }
}

export interface PatchTarget {
  backendId: string;
  /** Read side: what the derivation queries. */
  deltaStore: DeltaStore;
  /** Write side: how a ground patch is applied. */
  executor: ISparqlExecutor;
  /**
   * The store itself, when the backend is in process. Its presence is what
   * makes a blank-node patch applicable at all — `DELETE DATA` cannot name one.
   */
  store: oxigraph.Store | null;
  /**
   * A store hydrated from data graphs, which discards writes on its next
   * reload. Previewing against one is meaningful; applying to one is not.
   */
  readOnly: boolean;
}

/** Resolve a backend IRI to the store a patch is derived from and applied to. */
export async function resolvePatchTarget(backendId: string): Promise<PatchTarget> {
  if (!backendId) {
    throw new PatchTargetError('A backendId is required');
  }

  if (backendId === LIBRARY_STORAGE_BACKEND_ID) {
    // It holds the entities and the auth graph. A patch log over the store that
    // *contains* the patch log is a knot with no use case behind it.
    throw new PatchTargetError('The library storage backend cannot be patched', 400);
  }

  if (backendId === EPHEMERAL_BACKEND_ID) {
    // The per-request ephemeral backend mints a fresh empty store for each
    // call, so a patch against it would describe a store that no longer exists
    // by the time anyone read it.
    throw new PatchTargetError('The ephemeral backend has no state to patch', 400);
  }

  const backend = await Backends.findByIri(backendId);
  if (!backend) {
    throw new PatchTargetError(`Backend not found: ${backendId}`, 404);
  }

  const backendTypeKey = backendTypeIriToKey(backend.backendType);
  if (!backendTypeKey) {
    throw new PatchTargetError(`Unsupported backend type: ${backend.backendType}`);
  }

  if (backendTypeKey === 'http') {
    if (!backend.endpoint) {
      throw new PatchTargetError('HTTP backend missing endpoint');
    }
    const envAuth = resolveBackendEnvAuth(backend.authEnvKey);
    const executor = new HttpSparqlExecutor({
      queryUrl: backend.endpoint,
      updateUrl: backend.endpoint,
      username: envAuth.username,
      password: envAuth.password,
      authHeader: envAuth.authHeader,
      queryMethod: backend.queryMethod ? queryMethodIriToKey(backend.queryMethod) : 'post',
    });
    return { backendId, deltaStore: executorDeltaStore(executor), executor, store: null, readOnly: false };
  }

  if (backendTypeKey === 'oxigraphEphemeral') {
    const store =
      oxigraphStoreManager.getEphemeralStore(backend.$id) ??
      oxigraphStoreManager.createEphemeralStore(backend.$id);
    return storeTarget(backendId, store);
  }

  if (backendTypeKey === 'oxigraphMemory') {
    const config = resolveOxigraphConfig(backend.oxigraphConfig, backend.$id)
      ?? { storeType: 'ephemeral' as const, mode: 'readOnly' as const };
    const store =
      oxigraphStoreManager.getMemoryStore(backend.$id) ??
      (await oxigraphStoreManager.createMemoryStore(backend.$id, config));
    return storeTarget(backendId, store, (config.mode ?? 'readOnly') === 'readOnly');
  }

  throw new PatchTargetError(`Unsupported backend type: ${backend.backendType}`);
}

function storeTarget(backendId: string, store: oxigraph.Store, readOnly = false): PatchTarget {
  return {
    backendId,
    // The factory is what makes multi-operation programs previewable here: a
    // program whose later operation reads what an earlier one wrote is derived
    // against a throwaway copy of this store. HTTP backends get no factory and
    // keep the refusal, because copying a remote dataset to preview a write is
    // not a trade anyone would want made on their behalf.
    deltaStore: oxigraphDeltaStore(store, { createStore: () => new oxigraph.Store() }),
    executor: new OxigraphSparqlExecutor(store),
    store,
    readOnly,
  };
}
