/**
 * Can *this* container write the ETL output it is configured for?
 *
 * The question issue #466 asked the hard way. A fresh container runs as
 * `USER node` — uid 1000 — and the default output directory sits under the
 * declared volume `/app/packages/api/storage`, which Docker seeds from the
 * image's content *including its ownership*. Seeded root-owned, the first
 * execution somebody ever ran died on `mkdir` with EACCES, weeks after the
 * image was built.
 *
 * The image now prepares that directory owned by `node`, and with
 * `FEATURE_ETL=true` the API repeats the check at boot. Neither covers the
 * case this script is for: a volume or bind mount that already exists and
 * carries ownership no image can repair (see "Where a job execution's output
 * goes" in docs/guides/etl.md). So this
 * asks the question from inside whatever container it is run in, without
 * booting the API and without building a job first:
 *
 *   docker run --rm -v sparql-storage:/app/packages/api/storage \
 *     --entrypoint npx <image> tsx packages/api/scripts/storage-writability-smoke.ts
 *
 *   npx tsx scripts/storage-writability-smoke.ts            # the configured dir
 *   npx tsx scripts/storage-writability-smoke.ts /some/dir  # or a named one
 *   npx tsx scripts/storage-writability-smoke.ts --json     # for a machine
 *
 * Exits non-zero when the directory cannot be written, so a smoke test can gate
 * on it, and prints what a fix would need: the uid the process runs as, and the
 * owner and mode of the directory and of the mount point above it — the four
 * numbers the reproduction in #466 printed, which say whether the mount or the
 * image is at fault.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { checkEtlOutputDir, etlOutputDir } from '../src/lib/EtlService.js';

type PathReport = {
  path: string;
  exists: boolean;
  owner?: number;
  group?: number;
  mode?: string;
  /** Why it could not be described, when that is not "it is not there". */
  error?: string;
};

/**
 * Owner and mode as the issue's reproduction printed them, or why not.
 *
 * A failed `stat` is not the same as an absent directory, and the difference
 * matters here more than anywhere: a mount whose ancestors this uid may not
 * traverse fails with EACCES, and reporting that as "does not exist yet" would
 * describe the very permission problem this script exists to find as its
 * opposite.
 */
async function describePath(target: string): Promise<PathReport> {
  try {
    const stats = await fs.stat(target);
    return {
      path: target,
      exists: true,
      owner: stats.uid,
      group: stats.gid,
      mode: (stats.mode & 0o777).toString(8),
    };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return { path: target, exists: false };
    }
    return {
      path: target,
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const named = args.find((arg) => !arg.startsWith('--'));
  const dir = named ? path.resolve(named) : etlOutputDir();

  // The parent is reported as well as the target because it is the mount point:
  // a writable `etl-output` inside a root-owned `storage` is a different
  // deployment from both of them being root-owned, and only the parent's
  // ownership says which fix applies.
  // Both are read *before* the check, which creates the directory when it can:
  // what the mount arrived as is the thing being reported on.
  const [parent, target] = await Promise.all([
    describePath(path.dirname(dir)),
    describePath(dir),
  ]);
  const check = await checkEtlOutputDir(dir);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const gid = typeof process.getgid === 'function' ? process.getgid() : null;

  if (json) {
    console.log(JSON.stringify({ uid, gid, parent, target, check }));
    return check.writable ? 0 : 1;
  }

  console.log(`process: uid ${uid ?? 'unknown'}, gid ${gid ?? 'unknown'}`);
  for (const report of [parent, target]) {
    if (report.exists) {
      console.log(`${report.path}: owner ${report.owner}:${report.group}, mode ${report.mode}`);
    } else if (report.error) {
      console.log(`${report.path}: cannot be read — ${report.error}`);
    } else {
      console.log(`${report.path}: does not exist yet`);
    }
  }

  if (check.writable) {
    console.log(`ETL output directory is writable: ${check.dir}`);
    return 0;
  }

  console.error(`ETL output directory is NOT writable: ${check.dir} — ${check.error}`);
  if (check.hint) {
    console.error(check.hint);
  }
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
