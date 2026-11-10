import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RestoreError, restoreDatabase, type CommandRunner } from '../../src/replication/restore.js';

describe('restoreDatabase', () => {
  let dir: string;
  let file: string;
  const calls: string[][] = [];

  /** Acts as `litestream restore`: writes `-o` when a replica "exists". */
  const runner = (replica: string | null, code = 0, output = ''): CommandRunner => async (_command, args) => {
    calls.push([...args]);
    const out = args[args.indexOf('-o') + 1];
    if (code === 0 && replica !== null) fs.writeFileSync(out, replica);
    return { code, output };
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlib-restore-'));
    file = path.join(dir, 'lib', 'library.sqlite');
    calls.length = 0;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const restore = (policy: 'replica' | 'local' | 'never', run: CommandRunner) =>
    restoreDatabase({ name: 'library', path: file }, { policy, configPath: '/cfg.yml', litestreamBin: 'litestream', run });

  it('restores through a staging file and replaces the local file and its sidecars', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'old');
    fs.writeFileSync(`${file}-wal`, 'old wal');
    fs.mkdirSync(path.join(path.dirname(file), '.library.sqlite-litestream'));

    expect(await restore('replica', runner('from replica'))).toBe('restored');
    expect(calls[0]).toEqual(['restore', '-config', '/cfg.yml', '-if-replica-exists', '-o', `${file}.restoring`, file]);
    expect(fs.readFileSync(file, 'utf8')).toBe('from replica');
    expect(fs.existsSync(`${file}-wal`)).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(file), '.library.sqlite-litestream'))).toBe(false);
    expect(fs.existsSync(`${file}.restoring`)).toBe(false);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('keeps the local file when there is no replica yet', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'seed');
    expect(await restore('replica', runner(null))).toBe('no-replica');
    expect(fs.readFileSync(file, 'utf8')).toBe('seed');
  });

  it('fails closed and leaves the local file alone when Litestream fails', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'seed');
    const failing = runner('x', 1, 'level=INFO\nError: api error SignatureDoesNotMatch\n');
    await expect(restore('replica', failing)).rejects.toThrow(RestoreError);
    await expect(restore('replica', failing)).rejects.toThrow(/SignatureDoesNotMatch/);
    expect(fs.readFileSync(file, 'utf8')).toBe('seed');
  });

  it('fails closed when Litestream cannot be run', async () => {
    const missing: CommandRunner = async () => { throw new Error('spawn litestream ENOENT'); };
    await expect(restore('replica', missing)).rejects.toThrow(/Could not run litestream/);
  });

  it('keeps a non-empty local file under the local policy', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'mine');
    expect(await restore('local', runner('replica'))).toBe('kept-local');
    expect(calls).toHaveLength(0);
  });

  it('restores under the local policy when the local file is missing or empty', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    expect(await restore('local', runner('replica'))).toBe('restored');
  });

  it('does nothing under the never policy', async () => {
    expect(await restore('never', runner('replica'))).toBe('skipped');
    expect(calls).toHaveLength(0);
  });
});
