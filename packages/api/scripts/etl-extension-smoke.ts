/**
 * Which DuckDB extensions does *this* runtime actually have?
 *
 * A DuckDB extension is published per platform, and the published set differs
 * between them — the libc counts as much as the CPU. The image this project
 * ships is Debian-based, so DuckDB's platform there is `linux_amd64`, which the
 * community registry serves; on a musl image it is `linux_amd64_musl`, for
 * which that registry has published nothing since DuckDB v1.5.0, so
 * `INSTALL webbed FROM community` (the XML reader) 404s. That is what issue
 * #468 hit, and why the image is not Alpine — see "DuckDB extensions and the
 * image's libc" in docs/guides/etl.md.
 * Nothing in the API says so until an ingestion fails on it.
 *
 * So this asks the question before the ingestion does, from inside whatever
 * container it is run in:
 *
 *   docker run --rm -e ETL_DUCKDB_ALLOW_FILESYSTEM=true -e ETL_DUCKDB_ALLOW_HTTP=true \
 *     -e ETL_DUCKDB_ALLOW_EXTENSION_INSTALL=true --entrypoint npx \
 *     <image> tsx packages/api/scripts/etl-extension-smoke.ts webbed
 *
 *   npx tsx scripts/etl-extension-smoke.ts              # platform only
 *   npx tsx scripts/etl-extension-smoke.ts webbed json  # and these extensions
 *
 * Each name is checked against the `community` repository unless it is given as
 * `name@repository` (`json@core` for a core extension). Exits non-zero if any
 * named extension cannot be loaded, so a smoke test can gate on it. Loading an
 * extension needs the capabilities "The DuckDB capability profile" in
 * docs/guides/etl.md lists — with the
 * default profile every install fails, which is the correct answer for that
 * deployment rather than a fault in the check.
 *
 * Do not work around a missing musl build by loading a glibc extension into
 * this runtime. See "DuckDB extensions and the image's libc" in
 * docs/guides/etl.md for the options that work.
 */
import { duckDbService } from '../src/lib/DuckDbService.js';
import { describeDuckDbCapabilities, resolveDuckDbCapabilities } from '../src/lib/duckdbCapabilities.js';

async function main(): Promise<number> {
  await duckDbService.waitForInit();
  if (!duckDbService.isAvailable()) {
    console.error('DuckDB is not available in this runtime; ETL is disabled here.');
    return 1;
  }

  const platform = await duckDbService.getPlatform();
  console.log(`platform: ${platform}`);
  console.log(`capabilities: ${describeDuckDbCapabilities(resolveDuckDbCapabilities())}`);

  const requested = process.argv.slice(2);
  if (requested.length === 0) {
    return 0;
  }

  let failed = false;
  for (const arg of requested) {
    const [name, repository = 'community'] = arg.split('@');
    const result = await duckDbService.checkExtension(name, {
      repository: repository === 'core' ? undefined : repository,
    });
    if (result.loaded) {
      console.log(`${name}: ok (installed and loaded on ${result.platform})`);
      continue;
    }
    failed = true;
    const stage = result.installed ? 'installed but could not be loaded' : 'could not be installed';
    console.error(`${name}: ${stage} on ${result.platform} — ${result.error}`);
  }

  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
