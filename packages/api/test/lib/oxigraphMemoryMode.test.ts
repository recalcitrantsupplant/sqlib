/**
 * `INTERNAL_BACKEND_TYPE=oxigraph-memory` keeps the library in memory and
 * nowhere else.
 *
 * It used to build a durable store: restored from a `.nq` under the storage
 * directory at boot and serialised there at shutdown, so "ephemeral" survived
 * restarts. This writes through the library executor, shuts down, and checks
 * that nothing reached disk and that the next boot starts empty.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import { config } from '../../src/server/config.js';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter(entry => entry.isFile()).map(entry => entry.name);
}

async function tripleCount(): Promise<number> {
  const executor = await new ExecutorFactory().getExecutorForBackendId(LIBRARY_STORAGE_BACKEND_ID);
  const { result } = await executor.selectQueryParsed('SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }');
  const bindings = typeof result === 'string' ? [] : result.results.bindings;
  return Number((bindings[0]?.n as { value?: string } | undefined)?.value ?? 0);
}

describe('oxigraph-memory internal backend', () => {
  let storageDir: string;
  const backendBefore = config.internalBackend;

  beforeAll(async () => {
    // Set rather than assumed: in the shared module registry another file may
    // have left the config singleton pointing elsewhere.
    config.internalBackend = { type: 'oxigraph-memory' };
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlib-memory-mode-'));
    oxigraphStoreManager.reset(storageDir);
    await oxigraphStoreManager.initialize(storageDir);
  });

  afterAll(async () => {
    config.internalBackend = backendBefore;
    oxigraphStoreManager.reset();
    if (storageDir) await fs.rm(storageDir, { recursive: true, force: true });
  });

  it('writes nothing to disk at shutdown and starts empty on the next boot', async () => {
    const executor = await new ExecutorFactory().getExecutorForBackendId(LIBRARY_STORAGE_BACKEND_ID);
    await executor.update('INSERT DATA { <urn:test:s> <urn:test:p> "o" }');
    expect(await tripleCount()).toBe(1);

    await oxigraphStoreManager.shutdown();
    expect(await filesUnder(storageDir)).toEqual([]);

    oxigraphStoreManager.reset(storageDir);
    await oxigraphStoreManager.initialize(storageDir);
    expect(await tripleCount()).toBe(0);
  });
});
