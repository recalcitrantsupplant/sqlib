import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `scripts/storage-writability-smoke.ts`, run for real.
 *
 * This exists because of a gap in the suite beside it:
 * `test/lib/EtlService.outputDir.test.ts` skips its two EACCES cases when the
 * process is root, since root ignores the mode bits — and CI, the container the
 * image is built in, and the image's own build all run as root. So the hint
 * text that issue #466 is *about* ("give the mounted storage that ownership")
 * was asserted only on a developer's laptop, and never where a regression would
 * be caught.
 *
 * Dropping privileges in the child covers it: as root the smoke script is
 * spawned as an unprivileged uid against a root-owned directory, which is the
 * reported failure exactly — a process that is not the owner of the mount it
 * must write to. As a non-root user the same shape is made with a read-only
 * directory. Either way the assertion runs.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '../..');
const script = path.join(pkgRoot, 'scripts/storage-writability-smoke.ts');
const tsx = path.join(pkgRoot, 'node_modules/.bin/tsx');

/** uid 65534 is `nobody` on the Debian base this image is built from. */
const NOBODY = 65534;
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

type SmokeResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Present for a `--json` run, which is every run but the human-output one. */
  report: {
    uid: number | null;
    parent: { path: string; exists: boolean; owner?: number; mode?: string; error?: string };
    target: { path: string; exists: boolean; owner?: number; mode?: string };
    check: { dir: string; writable: boolean; error?: string; hint?: string };
  };
};

/**
 * Run the script over `dir`, as `nobody` when we are root.
 *
 * `HOME` is redirected because the unprivileged child may not read root's, and
 * the JSON is taken from the last `{`-led line rather than the whole of stdout:
 * importing `EtlService` loads `DuckDbService`, which announces itself.
 */
async function runSmoke(dir: string, args: string[] = ['--json']): Promise<SmokeResult> {
  const child = spawn(tsx, [script, ...args, dir], {
    cwd: pkgRoot,
    env: { ...process.env, HOME: os.tmpdir() },
    ...(asRoot ? { uid: NOBODY, gid: NOBODY } : {}),
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  const line = stdout.trimEnd().split('\n').reverse().find((l) => l.startsWith('{'));
  if (!line && args.includes('--json')) {
    throw new Error(`no JSON report in smoke output.\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
  return { code, stdout, stderr, report: line ? JSON.parse(line) : null };
}

describe('storage-writability-smoke', () => {
  const made: string[] = [];

  afterEach(async () => {
    for (const dir of made.splice(0)) {
      await fs.chmod(dir, 0o755).catch(() => {});
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  /** A storage mount the running user may write to, as a fresh volume now is. */
  async function writableStorage(): Promise<string> {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlib-storage-ok-'));
    made.push(base);
    await fs.chmod(base, 0o777);
    return base;
  }

  /** A storage mount owned by somebody else: the #466 report, as a directory. */
  async function foreignStorage(): Promise<string> {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlib-storage-foreign-'));
    made.push(base);
    // Root keeps its own ownership and the child drops to `nobody`; a non-root
    // run cannot change owner, so it takes away its own write bit instead.
    await fs.chmod(base, asRoot ? 0o755 : 0o555);
    return base;
  }

  it('says a mount it may not even look at cannot be read, rather than that it is absent', async () => {
    // An unreadable *ancestor* is the same deployment mistake one level up, and
    // the report has to keep the two apart: "does not exist yet" about a
    // directory that is there and forbidden would send the reader to the wrong
    // fix entirely.
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlib-storage-closed-'));
    made.push(base);
    const storage = path.join(base, 'storage');
    await fs.mkdir(storage);
    // Owner-only is enough to shut out the `nobody` the root run drops to, and
    // nothing at all to shut out the owner itself — which is who reads it when
    // the tests are not root, and which is how CI reads it.
    await fs.chmod(base, asRoot ? 0o700 : 0o000);

    const { code, report } = await runSmoke(path.join(storage, 'etl-output'));

    expect(code).toBe(1);
    expect(report.parent).toMatchObject({ path: storage, exists: false });
    expect(report.parent.error).toMatch(/EACCES|EPERM/);
  }, 60_000);

  it('reports a writable storage mount and exits 0', async () => {
    const dir = path.join(await writableStorage(), 'etl-output');

    const { code, report } = await runSmoke(dir);

    expect(code).toBe(0);
    expect(report.check).toMatchObject({ dir, writable: true });
    if (asRoot) {
      expect(report.uid).toBe(NOBODY);
    }
  }, 60_000);

  it('leaves the directory behind it created, and no probe file', async () => {
    const dir = path.join(await writableStorage(), 'etl-output');

    await runSmoke(dir);

    expect(await fs.readdir(dir)).toEqual([]);
  }, 60_000);

  it('exits non-zero on a mount this user does not own, naming the uid and the fix', async () => {
    const storage = await foreignStorage();
    const dir = path.join(storage, 'etl-output');

    const { code, report, stderr } = await runSmoke(dir);

    expect(code).toBe(1);
    expect(report.check.writable).toBe(false);
    expect(report.check.error).toMatch(/EACCES|EPERM/);
    // The hint is the deliverable of #466: the reader has to learn that the
    // mount wants chowning to the uid the container runs as.
    expect(report.check.hint).toContain('chown -R');
    expect(report.check.hint).toContain('ETL_OUTPUT_DIR');
    expect(report.check.hint).toContain('docs/guides/etl.md');
  }, 60_000);

  it('says the same thing to an operator reading the log, not only to --json', async () => {
    const storage = await foreignStorage();
    const dir = path.join(storage, 'etl-output');

    const { code, stdout, stderr } = await runSmoke(dir, []);

    expect(code).toBe(1);
    expect(stderr).toContain('NOT writable');
    expect(stderr).toContain(dir);
    expect(stderr).toContain('chown -R');
    // The mount's own ownership goes to stdout beside it, since the failure
    // cannot be read without it.
    expect(stdout).toContain(storage);
  }, 60_000);

  it('describes the mount point, which is what says whether the mount or the image is at fault', async () => {
    const storage = await foreignStorage();

    const { report } = await runSmoke(path.join(storage, 'etl-output'));

    expect(report.parent).toMatchObject({ path: storage, exists: true, mode: asRoot ? '755' : '555' });
    if (asRoot) {
      // The four numbers the issue's reproduction printed: this uid against
      // that owner.
      expect(report.parent.owner).toBe(0);
      expect(report.uid).toBe(NOBODY);
    }
  }, 60_000);
});
