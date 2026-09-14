#!/usr/bin/env node
/**
 * Emit CommonJS-flavoured declarations (`.d.cts`) beside the ESM ones tsc wrote.
 *
 * The runtime packages ship both formats — tsup builds `dist/x.js` and
 * `dist/x.cjs` — but tsc emits declarations once, as `.d.ts`. Under a
 * `"type": "module"` package those are ESM declarations, so a `require`
 * resolution has nothing to find: TypeScript maps `./dist/index.cjs` to
 * `./dist/index.d.cts`, never to `.d.ts`. A CommonJS consumer therefore gets
 * `TS7016 — could not find a declaration file`, on a package whose whole point
 * is to be installed from npm.
 *
 * The fix is a copy per declaration with relative `.js` specifiers rewritten to
 * `.cjs`, so a `.d.cts` only ever reaches other `.d.cts` files and the chain
 * stays CommonJS end to end. Bare specifiers are left alone: they resolve
 * through the dependency's own exports map, which picks the `require`
 * condition on its own.
 *
 * Usage: node scripts/emit-cjs-declarations.mjs <dist-dir>
 */
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

/** `from './x.js'` and `export * from '../y.js'`. */
const FROM_SPECIFIER = /(\bfrom\s*)(['"])(\.{1,2}\/[^'"\n]*)\.js\2/g;
/** `import('./x.js')`, which appears in inferred types. */
const DYNAMIC_IMPORT = /(\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]*)\.js\2/g;

const toCjsSpecifiers = (source) =>
  source
    .replace(FROM_SPECIFIER, '$1$2$3.cjs$2')
    .replace(DYNAMIC_IMPORT, '$1$2$3.cjs$2');

/** Every file under `dir`, relative to it. */
async function* walk(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) yield* walk(path.join(dir, entry.name), rel);
    else yield rel;
  }
}

const distDir = path.resolve(process.argv[2] ?? 'dist');

const files = [];
for await (const file of walk(distDir)) files.push(file);

const declarations = files.filter((f) => f.endsWith('.d.ts'));
if (declarations.length === 0) {
  console.error(`emit-cjs-declarations: no .d.ts files under ${distDir}`);
  process.exit(1);
}

// Drop stale copies first: tsup builds with `--clean false`, so a `.d.cts` whose
// source module is gone would otherwise sit in the tarball forever.
const expected = new Set(declarations.map((f) => `${f.slice(0, -'.d.ts'.length)}.d.cts`));
await Promise.all(
  files
    .filter((f) => f.endsWith('.d.cts') && !expected.has(f))
    .map((f) => unlink(path.join(distDir, f))),
);

await Promise.all(
  declarations.map(async (file) => {
    const source = await readFile(path.join(distDir, file), 'utf8');
    const target = path.join(distDir, `${file.slice(0, -'.d.ts'.length)}.d.cts`);
    await writeFile(target, toCjsSpecifiers(source));
  }),
);

console.log(`emit-cjs-declarations: wrote ${declarations.length} .d.cts files to ${distDir}`);
