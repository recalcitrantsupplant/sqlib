#!/usr/bin/env node
/**
 * Publish-readiness gate for the workspace packages that go to npm.
 *
 * Release-plan decision D7 deferred npm publishing and said "all packages stay
 * `private: true`". Two no longer are — `@sparql-query-lib/runtime` and
 * `@sparql-query-lib/runtime-oxigraph`, the static-export packages of #258 —
 * and a package that is merely *not private* is not the same thing as a package
 * that installs correctly once published. The difference is only visible from
 * outside the workspace: inside it every import resolves through pnpm's
 * symlinks and the source, so a broken `exports` map, a file missing from the
 * tarball, or a dependency on a package that will never exist on the registry
 * all look fine right up until the first `npm install`.
 *
 * So this checks the published shape rather than the working tree:
 *
 *   - the metadata npm shows and consumers rely on (repository, homepage,
 *     bugs, license, engines, and `publishConfig.access` — a scoped package
 *     without it fails its first publish outright);
 *   - every `exports` target exists AND is covered by `files`, since anything
 *     outside `files` is absent from the tarball however correct the map is;
 *   - a `types` condition beside every JS condition, `.d.cts` for `require`
 *     and `.d.ts` for `import`. This is the one that was actually broken:
 *     TypeScript maps `./dist/index.cjs` to `./dist/index.d.cts` and never to
 *     `.d.ts`, so a CommonJS consumer got `TS7016 — could not find a
 *     declaration file` from a package that ships declarations;
 *   - no dependency on a workspace package that stays private, which would
 *     publish an uninstallable tarball;
 *   - `workspace:^` rather than `workspace:*` for peer ranges, because pnpm
 *     rewrites the latter to an exact pin at publish time and a peer dependency
 *     pinned to one patch version is a dependency-resolution trap.
 *
 * Requires a build: the `exports` targets are `dist/` files. CI runs it after
 * scripts/ci/build.sh; locally, `pnpm -r build` first.
 *
 * Usage: node scripts/check-publishable.mjs
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages');

/** Files npm always includes, `files` or not. */
const ALWAYS_PACKED = new Set(['package.json', 'readme.md', 'license', 'licence']);

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Every packages/* directory holding a package.json. */
function workspacePackages() {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(PACKAGES_DIR, e.name, 'package.json')))
    .map((e) => ({
      dir: path.join(PACKAGES_DIR, e.name),
      relDir: path.posix.join('packages', e.name),
      manifest: readJson(path.join(PACKAGES_DIR, e.name, 'package.json')),
    }));
}

/**
 * Walk an `exports` map, yielding `{ condition, target }` for every leaf, with
 * the condition chain that reached it (`['.', 'require', 'types']` etc).
 */
function* exportLeaves(node, trail = []) {
  if (typeof node === 'string') {
    yield { trail, target: node };
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) yield* exportLeaves(value, [...trail, key]);
}

/** `files` covers a target when the target sits under one of its entries. */
function coveredByFiles(target, files) {
  const rel = target.replace(/^\.\//, '');
  if (ALWAYS_PACKED.has(rel.toLowerCase())) return true;
  return (files ?? []).some((entry) => {
    const pattern = entry.replace(/^\.\//, '').replace(/\/+$/, '');
    return rel === pattern || rel.startsWith(`${pattern}/`);
  });
}

function checkPackage(pkg, byName) {
  const { manifest: m, dir, relDir } = pkg;
  const problems = [];
  const fail = (msg) => problems.push(msg);

  // --- metadata npm and consumers read -------------------------------------
  if (!m.description) fail('no "description"');
  if (!m.license) fail('no "license"');
  if (!m.repository?.url) fail('no "repository.url"');
  if (m.repository && m.repository.directory !== relDir) {
    fail(`"repository.directory" is ${JSON.stringify(m.repository.directory)}, expected "${relDir}"`);
  }
  if (!m.homepage) fail('no "homepage"');
  if (!m.bugs?.url) fail('no "bugs.url"');
  if (!m.engines?.node) fail('no "engines.node"');
  if (m.name.startsWith('@') && m.publishConfig?.access !== 'public') {
    fail('scoped package without "publishConfig.access": "public" — the first publish fails without it');
  }
  if (!Array.isArray(m.files) || m.files.length === 0) fail('no "files" allowlist');
  if (!existsSync(path.join(dir, 'README.md'))) fail('no README.md — it is the npm page');

  // --- the entry points, as a consumer resolves them -----------------------
  const isEsmPackage = m.type === 'module';
  const targetExists = (target) => {
    const file = path.join(dir, target.replace(/^\.\//, ''));
    return existsSync(file) && statSync(file).isFile();
  };

  for (const legacy of ['main', 'types']) {
    if (m[legacy] && !targetExists(m[legacy])) fail(`"${legacy}" points at missing ${m[legacy]}`);
  }

  if (!m.exports) fail('no "exports" map');

  for (const { trail, target } of exportLeaves(m.exports ?? {})) {
    const where = trail.join(' → ');
    if (!target.startsWith('./')) {
      fail(`export ${where} target ${target} is not a relative "./" path`);
      continue;
    }
    if (!targetExists(target)) fail(`export ${where} points at missing ${target} (build first?)`);
    if (!coveredByFiles(target, m.files)) {
      fail(`export ${where} target ${target} is outside "files" — it would not be in the tarball`);
    }
  }

  // Types conditions, per subpath. A JS condition with no `types` beside it is
  // the CommonJS-declarations trap this script exists to catch.
  const isJsTarget = (target) => /\.(?:js|cjs|mjs)$/.test(String(target));

  for (const [subpath, entry] of Object.entries(m.exports ?? {})) {
    if (typeof entry === 'string') {
      // Sugar form: `"./sub": "./dist/sub.js"` resolves but carries no types.
      if (isJsTarget(entry)) fail(`export "${subpath}" is a bare path with no "types" condition`);
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    for (const [condition, value] of Object.entries(entry)) {
      if (condition === 'types') continue;
      if (typeof value === 'string') {
        if (isJsTarget(value)) {
          fail(`export "${subpath}" → ${condition} is a bare path with no "types" condition beside it`);
        }
        continue;
      }
      if (typeof value !== 'object' || value === null) continue;
      const keys = Object.keys(value);
      if (!keys.includes('types')) {
        fail(`export "${subpath}" → ${condition} has no "types" condition`);
        continue;
      }
      if (keys[0] !== 'types') {
        fail(`export "${subpath}" → ${condition} lists "types" after ${keys[0]} — conditions match in order, so it must come first`);
      }
      const wantsCts = condition === 'require' && isEsmPackage;
      const expected = wantsCts ? '.d.cts' : '.d.ts';
      if (!String(value.types).endsWith(expected)) {
        fail(`export "${subpath}" → ${condition} types is ${value.types}, expected a ${expected} file (a "type": "module" package resolves ${condition} declarations by that extension alone)`);
      }
    }
  }

  // --- workspace dependencies survive publication --------------------------
  const ranges = [
    ['dependencies', m.dependencies],
    ['peerDependencies', m.peerDependencies],
    ['optionalDependencies', m.optionalDependencies],
  ];
  for (const [field, deps] of ranges) {
    for (const [name, range] of Object.entries(deps ?? {})) {
      if (!String(range).startsWith('workspace:')) continue;
      const target = byName.get(name);
      if (!target) {
        fail(`${field}."${name}" uses the workspace protocol but no such workspace package exists`);
        continue;
      }
      if (target.manifest.private === true) {
        fail(`${field}."${name}" is a private workspace package — the published tarball would be uninstallable`);
      }
      if (field === 'peerDependencies' && range === 'workspace:*') {
        fail(`peerDependencies."${name}" is "workspace:*", which pnpm publishes as an exact pin — use "workspace:^"`);
      }
    }
  }

  return problems;
}

const packages = workspacePackages();
const byName = new Map(packages.map((p) => [p.manifest.name, p]));
const publishable = packages.filter((p) => p.manifest.private !== true);

// Same discipline as the ratchets: a check that measures nothing must fail
// rather than report success. If every package goes back to `private: true`,
// delete this gate deliberately instead of letting it pass vacuously.
if (publishable.length === 0) {
  console.error('check-publishable: no publishable packages found in packages/*.');
  console.error('  Every package is `private: true`. If npm publishing was withdrawn, remove this check;');
  console.error('  if a package should publish, drop its `private` flag.');
  process.exit(1);
}

let failed = false;
for (const pkg of publishable) {
  const problems = checkPackage(pkg, byName);
  if (problems.length === 0) {
    console.log(`check-publishable: ${pkg.manifest.name} ok`);
    continue;
  }
  failed = true;
  console.error(`check-publishable: ${pkg.manifest.name} (${pkg.relDir})`);
  for (const problem of problems) console.error(`  - ${problem}`);
}

if (failed) {
  console.error('');
  console.error('Publishing is not wired up yet (release-plan D7, issue #258), but these packages are');
  console.error('not private, so the shape they would publish in is checked. Fix the above, or set');
  console.error('`"private": true` on a package that is not meant to reach npm.');
  process.exit(1);
}
