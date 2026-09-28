/**
 * The one generated input this buildless suite needs.
 *
 * A View that asks for the editor inlines `mcp-app/src/kit/editor.bundle.js`,
 * CodeMirror bundled by `mcp-app/scripts/bundle-editor.mjs`. It is build output
 * and gitignored, so a fresh checkout — CI's `test` job, which runs no build —
 * has none, and every test that renders the tutorial failed with ENOENT. Built
 * here when missing, rather than committed or faked: the tests then check the
 * View as it ships, and a checkout that has built already pays nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default function setup() {
  const bundle = fileURLToPath(new URL('../../mcp-app/src/kit/editor.bundle.js', import.meta.url));
  if (existsSync(bundle)) return;
  execFileSync(process.execPath, [fileURLToPath(new URL('../../mcp-app/scripts/bundle-editor.mjs', import.meta.url))], {
    stdio: 'inherit',
  });
}
