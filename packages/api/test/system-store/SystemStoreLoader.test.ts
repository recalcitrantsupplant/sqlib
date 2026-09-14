import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { SYSTEM_LIBRARY_ID, SystemQueryCatalog } from '../../src/lib/system-queries/SystemQueryCatalog.js';
import { loadSystemStore, resolveAssetDir } from '../../src/system-store/SystemStoreLoader.js';

describe('SystemStoreLoader', () => {
  it('loads system assets into an in-memory store and cache entries', async () => {
    const { cacheEntries, store, assetDir } = await loadSystemStore();

    expect(assetDir).toBe(resolveAssetDir());
    expect(store.size).toBeGreaterThan(0);

    const library = cacheEntries.get(SYSTEM_LIBRARY_ID);
    expect(library).toMatchObject({
      $id: SYSTEM_LIBRARY_ID,
      '@type': 'Library',
      name: 'System Library',
      description: 'Internal LDKit-managed queries for system exports.',
    });

    for (const def of SystemQueryCatalog.listDefinitions()) {
      const query = cacheEntries.get(def.queryId);
      const version = cacheEntries.get(def.versionId);
      expect(query).toBeTruthy();
      expect(version).toBeTruthy();
      expect(query).toMatchObject({
        $id: def.queryId,
        currentVersion: def.versionId,
        isPartOf: [SYSTEM_LIBRARY_ID],
      });
      expect(version).toMatchObject({
        $id: def.versionId,
        isPartOf: def.queryId,
        immutable: true,
        queryType: QueryTypeIri.construct,
      });
      expect((version as any).queryString).toContain('CONSTRUCT');
    }
  });

  it('fails fast on malformed assets', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'system-store-bad-'));
    await fs.writeFile(path.join(tempDir, 'broken.ttl'), '<this is not turtle>');

    try {
      await expect(loadSystemStore({ assetDir: tempDir })).rejects.toThrow(/Failed to parse system store asset/);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
