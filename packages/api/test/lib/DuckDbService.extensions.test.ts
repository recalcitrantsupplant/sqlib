/**
 * The extension capability check added for issue #468, where the published
 * Alpine image's DuckDB platform (`linux_amd64_musl`) has no community build of
 * `webbed`, and the only way to find out was to run an XML ingestion and watch
 * it 404.
 *
 * Real DuckDB, like the sandbox suite beside this one: what is being checked is
 * what the engine reports about itself, which a mock would only restate. No
 * assertion here reaches the network — the install that is exercised is one the
 * default capability profile refuses before any request is made.
 */
import { describe, it, expect } from 'vitest';
import { DuckDbService } from '../../src/lib/DuckDbService.js';

let duckdbAvailable = true;
try {
  await import('@duckdb/node-api');
} catch {
  duckdbAvailable = false;
}

describe.skipIf(!duckdbAvailable)('DuckDbService extension availability', () => {
  it('reports the platform extensions are published against', async () => {
    const service = new DuckDbService();
    await service.waitForInit();

    const platform = await service.getPlatform();

    // e.g. linux_amd64, linux_amd64_musl, osx_arm64 — an identifier, never empty.
    expect(platform).toMatch(/^[a-z0-9_]+$/);
    expect(platform).not.toBe('unknown');
  });

  it('reports a failed install rather than throwing, naming the platform it failed on', async () => {
    // The default profile has `enable_external_access=false`, so the install
    // fails inside DuckDB without a request leaving the process.
    const service = new DuckDbService();
    await service.waitForInit();

    const result = await service.checkExtension('webbed', { repository: 'community' });

    expect(result.extension).toBe('webbed');
    expect(result.installed).toBe(false);
    expect(result.loaded).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.platform).toMatch(/^[a-z0-9_]+$/);
  });

  it('refuses anything that is not an extension identifier', async () => {
    const service = new DuckDbService();
    await service.waitForInit();

    await expect(service.checkExtension('webbed; DROP TABLE t')).rejects.toThrow(/Not an extension name/);
    await expect(service.checkExtension('webbed', { repository: "x'" })).rejects.toThrow(/Not an extension repository/);
  });
});
