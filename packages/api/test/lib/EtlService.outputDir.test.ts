import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { checkEtlOutputDir, etlOutputDir } from '../../src/lib/EtlService.js';

/**
 * The boot-time writability check added for issue #466, where a fresh container
 * ran as uid 1000 against a root-owned `/app/packages/api/storage` and the
 * failure — `EACCES: permission denied, mkdir '.../etl-output'` — only appeared
 * once somebody executed their first job.
 */
describe('checkEtlOutputDir', () => {
  const made: string[] = [];

  afterEach(async () => {
    for (const dir of made.splice(0)) {
      await fs.chmod(dir, 0o755).catch(() => {});
      await fs.rm(dir, { recursive: true, force: true });
    }
    delete process.env.ETL_OUTPUT_DIR;
  });

  it('creates the directory it is asked about, and reports it writable', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'etl-preflight-'));
    made.push(base);
    const dir = path.join(base, 'etl-output');

    const result = await checkEtlOutputDir(dir);

    expect(result).toMatchObject({ dir, writable: true });
    await expect(fs.stat(dir)).resolves.toBeTruthy();
  });

  it('leaves nothing behind: the probe file is removed', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'etl-preflight-'));
    made.push(base);

    await checkEtlOutputDir(base);

    expect(await fs.readdir(base)).toEqual([]);
  });

  it('defaults to the directory executions write to', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'etl-preflight-'));
    made.push(base);
    process.env.ETL_OUTPUT_DIR = base;

    const result = await checkEtlOutputDir();

    expect(result.dir).toBe(etlOutputDir());
    expect(result.writable).toBe(true);
  });

  // root ignores the mode bits, so this can only be asserted as a non-root user
  // — which is exactly the situation the issue reported.
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  it.skipIf(asRoot)('reports an unwritable parent rather than throwing, with a hint naming the fix', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'etl-preflight-'));
    made.push(base);
    await fs.chmod(base, 0o555);

    const result = await checkEtlOutputDir(path.join(base, 'etl-output'));

    expect(result.writable).toBe(false);
    expect(result.error).toMatch(/EACCES|EPERM/);
    expect(result.hint).toContain('ETL_OUTPUT_DIR');
  });

  it.skipIf(asRoot)('reports a directory that exists but this user may not write to', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'etl-preflight-'));
    made.push(base);
    const dir = path.join(base, 'etl-output');
    await fs.mkdir(dir);
    await fs.chmod(dir, 0o555);
    made.push(dir);

    const result = await checkEtlOutputDir(dir);

    expect(result.writable).toBe(false);
  });
});
