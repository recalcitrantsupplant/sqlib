import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Build `@sparql-query-lib/runtime` if it has not been built.
 *
 * A handful of tests need the runtime's *built* CommonJS bundle rather than its
 * source: the demo page inlines that exact file into the HTML it generates, and
 * the tests that matter most check what gets inlined. (Resolution used to land
 * on the TypeScript source under tsx, producing a page that died on load while
 * every test passed — so testing the real artifact is the point, not an
 * incidental convenience.)
 *
 * CI's `test` job installs and runs vitest; it never builds, because `verify`
 * owns building. That left the dependency implicit and satisfied only by
 * whatever happened to be on disk — green locally, red on a clean checkout.
 * Making it explicit here is cheaper than either weakening the tests or
 * building every package before every test run: it is a no-op once `dist`
 * exists, which is the usual case.
 */
export default function setup(): void {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const built = path.join(repoRoot, 'packages', 'runtime', 'dist', 'index.cjs');
  if (existsSync(built)) return;

  console.log('[test setup] building @sparql-query-lib/runtime (dist/index.cjs is missing)');
  execFileSync('pnpm', ['--filter', '@sparql-query-lib/runtime', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (!existsSync(built)) {
    throw new Error(
      `Building @sparql-query-lib/runtime did not produce ${built}. The demo page tests inline that file.`,
    );
  }
}
