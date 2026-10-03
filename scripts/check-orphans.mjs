#!/usr/bin/env node
/**
 * Orphan-module ratchet. Reports source files that nothing can reach.
 *
 * Usage:
 *   node scripts/check-orphans.mjs            # report + fail on new orphans
 *   node scripts/check-orphans.mjs --update   # rewrite the baseline
 *   node scripts/check-orphans.mjs --json     # machine-readable output
 *
 * ## Why this exists
 *
 * Nothing in this repo could see a file that had stopped being used. `tsc`
 * type-checks what is imported and says nothing about what is not; the tests
 * only cover what they import; `pnpm -r lint` is nine `echo "TODO: add lint"`
 * scripts and one stylelint run. So dead code was invisible until someone went
 * looking, and by the time someone did there was `packages/api/src/types/
 * canvas-types.ts` (822 lines, zero importers), a whole
 * `packages/web/packages/web/src/pages/tests/` tree that was an accidental copy
 * left behind by a botched move, and `tsc` output committed under
 * `packages/contracts/src/` as if it were source.
 *
 * None of those are bugs. That is the point: nothing was ever going to fail
 * because of them, so nothing did, and they sat in the tree being read, grepped
 * and half-maintained. A file the graph cannot reach costs review attention and
 * misleads the next reader about what the system does.
 *
 * ## What "reachable" means here
 *
 * Roots are the things something outside the source graph can start from:
 * package entry points (`main`, `module`, `exports`, `bin`), files named in
 * package scripts, tests, tool configs, the Nuxt directories the framework
 * itself loads (`pages/`, `plugins/`, `layouts/`, `middleware/`, `app.vue` —
 * a page is reached by the router, not by an import), and any file a
 * root-level script, Justfile, Taskfile, Dockerfile or workflow names. From
 * those we follow static imports, re-exports, `require()` and dynamic
 * `import()` with a literal specifier.
 *
 * `components/` and `composables/` are deliberately not roots. Nuxt
 * auto-imports them, so they are reached two ways: an explicit import, or
 * their auto-import name used by a file that is itself reached — a component
 * by its tag in a template (`components/query-group/Foo.vue` is
 * `<QueryGroupFoo>`, see `nuxtComponentName`), a composable by one of its
 * exported names. Rooting the whole directories, as this check first did, made
 * every component look alive whether anything rendered it or not. And a
 * component or composable reached only from its own unit test is still dead
 * code — the test keeps it compiling, not used — so for those two directories
 * reachability is measured from product roots alone.
 *
 * Dynamic specifiers built at runtime are not followed — the resolver cannot
 * know them. That is the one way this check can be wrong in the direction that
 * matters (calling a live file dead), which is exactly why it is a baseline and
 * not a hard zero: an entry in the baseline is a claim that a human looked.
 *
 * ## Why a named baseline and not a count
 *
 * `scripts/count-any.mjs` ratchets a number because `as any` occurrences are
 * fungible — one is as bad as another. Orphans are not: "43 orphans" tells the
 * next reader nothing, and a count lets a genuinely dead file be swapped for a
 * newly-dead one at no cost. The baseline lists paths, so the diff of an
 * accepted orphan is legible in review, and deleting one lowers the baseline
 * automatically rather than leaving slack behind.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, posix } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'orphan-baseline.json');
const PACKAGES = join(ROOT, 'packages');

const SOURCE_EXT = ['.ts', '.tsx', '.vue', '.mjs', '.cjs', '.js'];
// `build` is not here: `packages/web/src/components/build/` is source (the
// Build screen), and skipping it hid that whole directory and everything only
// it imports. Build output called `build` is caught by the git-ignore filter.
const IGNORE_DIR = new Set([
  'node_modules', 'dist', '.nuxt', '.output', '.git', 'coverage', 'vendor',
]);

const rel = (p) => relative(ROOT, p).split('\\').join('/');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIR.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXT.some((e) => name.endsWith(e)) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

// --- module resolution ------------------------------------------------------
//
// Only enough of Node/TS/Nuxt resolution to follow first-party edges:
// relative specifiers, the `~`/`@` aliases Nuxt gives `packages/web/src`, and
// the `.js`-to-`.ts` rewrite that ESM-style TypeScript imports rely on. A
// specifier that resolves to a dependency is not our concern.
const WEB_SRC = join(PACKAGES, 'web', 'src');
const ALIASES = { '~': WEB_SRC, '@': WEB_SRC, '~~': join(PACKAGES, 'web'), '@@': join(PACKAGES, 'web') };

const CANDIDATE_SUFFIXES = [
  '', ...SOURCE_EXT,
  ...SOURCE_EXT.map((e) => `${posix.sep}index${e}`),
];

function resolveSpecifier(fromFile, spec) {
  let base;
  if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec);
  } else {
    const alias = Object.keys(ALIASES)
      .sort((a, b) => b.length - a.length)
      .find((a) => spec === a || spec.startsWith(`${a}/`));
    if (!alias) return null;
    base = resolve(ALIASES[alias], spec.slice(alias.length + 1));
  }

  const bases = [base];
  // `import './x.js'` in TypeScript source means `./x.ts` on disk.
  if (base.endsWith('.js')) bases.push(base.slice(0, -3));

  for (const b of bases) {
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = b + suffix;
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

const IMPORT_RE = new RegExp(
  [
    // import ... from 'x' / import 'x'
    String.raw`import\s+(?:[\w*\s{},$]*?\s+from\s+)?['"]([^'"]+)['"]`,
    // export ... from 'x'
    String.raw`export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]`,
    // require('x') / import('x')
    String.raw`(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)`,
    // new URL('./x', import.meta.url) — how ESM names a sibling file it reads,
    // spawns or hands to a bundler rather than importing.
    String.raw`new\s+URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)`,
  ].join('|'),
  'g',
);

function importsOf(file) {
  const src = readFileSync(file, 'utf8');
  const specs = new Set();
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (spec) specs.add(spec);
  }
  return [...specs];
}

// --- roots ------------------------------------------------------------------

const TEST_RE = /\.(test|spec)\.[jt]sx?$|(^|\/)(test|tests|__tests__|manual-tests)(\/|$)/;
// Under the web app's source tree `tests` is a product feature (the test-runs
// UI lives in `components/tests/`), not a test directory — `.dockerignore`
// makes the same exception. Only real test files count as tests there.
const WEB_SRC_TEST_RE = /\.(test|spec)\.[jt]sx?$|(^|\/)__tests__(\/|$)/;
const isTest = (r) => (r.startsWith('packages/web/src/') ? WEB_SRC_TEST_RE : TEST_RE).test(r);
const CONFIG_RE = /^(vitest|vite|playwright|playwright\.\w+|nuxt|tailwind|stylelint|eslint|commitlint|drizzle)\.config\.[cm]?[jt]s$/;
// Nuxt loads these itself (routing, plugin and layout registration), so no
// import edge points at them and they would all read as orphans. Components
// and composables are not here: they are reached through auto-import names,
// below, and are only alive if something reached uses them.
const WEB_CONVENTION_DIRS = ['pages', 'plugins', 'layouts', 'middleware', 'server', 'app'];

function packageRoots(pkgDir, files) {
  const roots = new Set();
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return roots;
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

  // Published entry points name build output; map it back to source.
  const declared = [];
  for (const key of ['main', 'module', 'types', 'browser']) {
    if (typeof pkg[key] === 'string') declared.push(pkg[key]);
  }
  const collectExports = (node) => {
    if (typeof node === 'string') declared.push(node);
    else if (node && typeof node === 'object') Object.values(node).forEach(collectExports);
  };
  collectExports(pkg.exports);
  if (typeof pkg.bin === 'string') declared.push(pkg.bin);
  else if (pkg.bin) declared.push(...Object.values(pkg.bin));

  for (const entry of declared) {
    const asSource = entry
      .replace(/^\.\//, '')
      .replace(/^dist\//, 'src/')
      .replace(/\.(js|mjs|cjs|d\.ts)$/, '.ts');
    const hit = resolveSpecifier(join(pkgDir, 'package.json'), `./${asSource}`);
    if (hit) roots.add(hit);
  }

  // Anything a package script runs directly.
  for (const script of Object.values(pkg.scripts ?? {})) {
    for (const m of String(script).matchAll(/[\w./-]+\.(?:tsx?|mjs|cjs|js)/g)) {
      const hit = resolveSpecifier(join(pkgDir, 'package.json'), `./${m[0]}`);
      if (hit) roots.add(hit);
    }
  }

  if (rel(pkgDir).endsWith('/web')) {
    for (const file of files) {
      const r = rel(file);
      if (WEB_CONVENTION_DIRS.some((d) => r.includes(`/src/${d}/`)) || r.endsWith('/src/app.vue')) {
        roots.add(file);
      }
    }
  }

  return roots;
}

/**
 * Text outside `packages/` that can name a file directly: CI scripts, the
 * Justfile and Taskfile, Dockerfiles, workflows. A path mentioned there is
 * reachable even though no module imports it.
 */
function externallyNamedFiles(files) {
  const blobs = [];
  const collect = (dir) => {
    for (const name of readdirSync(dir)) {
      if (IGNORE_DIR.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (full === PACKAGES) continue;
        collect(full);
      } else if (full === BASELINE_PATH) {
        // Skip our own baseline: it lists orphan paths, so reading it here
        // would make every accepted orphan look externally reachable and the
        // check would report an empty set no matter what the tree holds.
        continue;
      } else if (/\.(ya?ml|sh|mjs|cjs|js|json|toml)$/.test(name) || /^(Justfile|Taskfile\.yml|Dockerfile.*)$/.test(name)) {
        blobs.push(readFileSync(full, 'utf8'));
      }
    }
  };
  collect(ROOT);
  const blob = blobs.join('\n');
  // Whole paths only. Matching on basenames alone made every `index.ts` look
  // reachable, which is how a check like this quietly stops checking.
  return new Set(files.filter((f) => blob.includes(rel(f))));
}

// --- Nuxt auto-imports (packages/web) ---------------------------------------
//
// The second kind of edge: a file in the web app that names a component in its
// template, or calls a composable, without importing it. Nuxt resolves those
// names at build time, so we resolve them the same way.
const WEB_COMPONENTS = join(WEB_SRC, 'components');
const WEB_COMPOSABLES = join(WEB_SRC, 'composables');
// shadcn-nuxt registers what each `components/ui/<name>/index.ts` exports, under
// the export's own name, instead of the default path-prefixed name.
const WEB_UI = join(WEB_COMPONENTS, 'ui');

/** scule's `splitByCase`, which Nuxt uses to build component names. */
function splitByCase(s) {
  return s
    .split(/[-_\s./\\]+/)
    .flatMap((part) => part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [])
    .filter(Boolean);
}

const pascal = (parts) => parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('');

/**
 * The tag Nuxt's default component scan gives a file: its directories as a
 * prefix, then its own name, with a prefix the file name already repeats
 * dropped (`query-group/QueryGroupCanvasNode.vue` is `QueryGroupCanvasNode`,
 * not `QueryGroupQueryGroupCanvasNode`). Mirrors `resolveComponentNameSegments`
 * in nuxt/src/components/scan.ts.
 */
function nuxtComponentName(file) {
  const parts = relative(WEB_COMPONENTS, file).split(/[\\/]/);
  let fileName = parts.pop().replace(/\.[^.]+$/, '');
  if (fileName.toLowerCase() === 'index' && parts.length) fileName = parts.pop();
  const fileNameParts = splitByCase(fileName);
  const fileNameContent = fileNameParts.join('/').toLowerCase();
  const nameParts = parts.flatMap((p) => splitByCase(p));
  const matched = [];
  let prefixLength = nameParts.length;
  let consumed = nameParts.length;
  for (let index = parts.length - 1; index >= 0; index--) {
    const segment = splitByCase(parts[index]);
    consumed -= segment.length;
    matched.unshift(...segment.map((p) => p.toLowerCase()));
    const suffix = matched.join('/');
    if (fileNameContent === suffix || fileNameContent.startsWith(`${suffix}/`)) prefixLength = consumed;
  }
  return pascal([...nameParts.slice(0, prefixLength), ...fileNameParts]);
}

const kebab = (name) => splitByCase(name).map((p) => p.toLowerCase()).join('-');

/** Names a module exports, for composables and shadcn index files. */
function exportedNames(file) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s+(?!type\b)\{([^}]*)\}/g)) {
    for (const item of m[1].split(',')) {
      const name = item.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default') names.add(name);
    }
  }
  return names;
}

/**
 * tag -> component file, and identifier -> composable file, for every
 * component and composable Nuxt would auto-import from this tree.
 */
function autoImportTables(files) {
  const tags = new Map();
  const identifiers = new Map();
  for (const file of files) {
    if (file.startsWith(`${WEB_UI}/`)) {
      // ui/<name>/index.ts, one level down: shadcn's registration.
      if (/^[^/\\]+[/\\]index\.ts$/.test(relative(WEB_UI, file))) {
        for (const name of exportedNames(file)) if (/^[A-Z]/.test(name)) tags.set(name, file);
      }
    } else if (file.startsWith(`${WEB_COMPONENTS}/`) && file.endsWith('.vue')) {
      tags.set(nuxtComponentName(file), file);
    } else if (file.startsWith(`${WEB_COMPOSABLES}/`)) {
      // Nuxt scans the top level of composables/ and `<dir>/index.ts`.
      const r = relative(WEB_COMPOSABLES, file).split(/[\\/]/);
      const scanned = r.length === 1 || (r.length === 2 && /^index\.[jt]s$/.test(r[1]));
      if (scanned && !isTest(rel(file))) {
        for (const name of exportedNames(file)) identifiers.set(name, file);
      }
    }
  }
  // Kebab-case and `Lazy`-prefixed tags resolve to the same component.
  for (const [name, file] of [...tags]) {
    tags.set(kebab(name), file);
    tags.set(`Lazy${name}`, file);
    tags.set(`lazy-${kebab(name)}`, file);
  }
  return { tags, identifiers };
}

let autoImports = null;

/** Files a web source file reaches by auto-import name rather than by import. */
function autoImportedBy(file) {
  if (!file.startsWith(`${WEB_SRC}/`)) return [];
  const src = readFileSync(file, 'utf8');
  const out = new Set();
  if (file.endsWith('.vue')) {
    for (const m of src.matchAll(/<([A-Za-z][\w-]*)/g)) {
      const hit = autoImports.tags.get(m[1]);
      if (hit) out.add(hit);
    }
  }
  for (const m of src.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const hit = autoImports.identifiers.get(m[0]);
    if (hit) out.add(hit);
  }
  out.delete(file);
  return [...out];
}

// --- the check --------------------------------------------------------------

/**
 * Files git ignores are not in the tree: they are build output a package writes
 * beside its source (the MCP App's bundled editor is one), present only in a
 * checkout that has been built. Judging them made the check's answer depend on
 * whether you had run a build, and a fresh CI checkout never has. Asked of git
 * rather than re-implemented, and only about the files the walk found. Outside a
 * git checkout nothing is excluded.
 */
function gitIgnored(paths) {
  if (paths.length === 0) return new Set();
  const result = spawnSync('git', ['check-ignore', '--stdin'], {
    cwd: ROOT,
    input: paths.map(rel).join('\n'),
    encoding: 'utf8',
  });
  // Exit 1 means "none ignored"; anything else but 0 means git could not answer.
  if (result.status !== 0 && result.status !== 1) return new Set();
  return new Set(result.stdout.split('\n').filter(Boolean));
}

const walked = walk(PACKAGES);
const ignored = gitIgnored(walked);
const files = walked.filter((f) => !ignored.has(rel(f)));
const roots = new Set();

for (const name of readdirSync(PACKAGES)) {
  const pkgDir = join(PACKAGES, name);
  if (!statSync(pkgDir).isDirectory() || IGNORE_DIR.has(name)) continue;
  const pkgFiles = files.filter((f) => f.startsWith(`${pkgDir}/`));
  for (const r of packageRoots(pkgDir, pkgFiles)) roots.add(r);
}

const testRoots = new Set();
for (const file of files) {
  const r = rel(file);
  if (isTest(r)) testRoots.add(file);
  else if (CONFIG_RE.test(r.split('/').pop())) roots.add(file);
}
for (const file of externallyNamedFiles(files)) roots.add(file);

autoImports = autoImportTables(files);

function reach(from) {
  const reached = new Set();
  const queue = [...from];
  while (queue.length) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    for (const spec of importsOf(file)) {
      const target = resolveSpecifier(file, spec);
      if (target && !reached.has(target)) queue.push(target);
    }
    for (const target of autoImportedBy(file)) {
      if (!reached.has(target)) queue.push(target);
    }
  }
  return reached;
}

// Reachable from the product alone, and from the product plus its tests.
const productReachable = reach(roots);
const reachable = reach([...roots, ...testRoots]);
for (const file of testRoots) roots.add(file);

// A web component or composable only a test reaches is dead all the same.
const productOnly = (f) => f.startsWith(`${WEB_COMPONENTS}/`) || f.startsWith(`${WEB_COMPOSABLES}/`);
const orphans = files
  .filter((f) => !reachable.has(f) || (productOnly(f) && !isTest(rel(f)) && !productReachable.has(f)))
  .map(rel)
  .sort();

// The measures-nothing guard every gate in this repo needs: a scan that found
// no files reports zero orphans, which is the same answer a spotless tree
// gives. If `packages/` moves or the extension list stops matching anything,
// fail loudly instead of scoring a tree we never read. Same reasoning as the
// crashed-checker guard in scripts/ci/typecheck.sh.
if (files.length === 0 || roots.size === 0) {
  console.error(`orphan ratchet: scanned ${files.length} file(s) from ${roots.size} root(s) under ${rel(PACKAGES)}.`);
  console.error('That is a broken scan, not a clean tree — both report zero orphans.');
  process.exit(1);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: files.length, orphans }, null, 2));
  process.exit(0);
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ orphans }, null, 2)}\n`);
  console.log(`orphan baseline updated: ${orphans.length} accepted orphan(s)`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`orphan ratchet: no baseline at ${rel(BASELINE_PATH)}`);
  console.error('Record the current set with: node scripts/check-orphans.mjs --update');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).orphans ?? [];
const accepted = new Set(baseline);
const added = orphans.filter((o) => !accepted.has(o));
const removed = baseline.filter((b) => !orphans.includes(b));

console.log(`orphan ratchet: ${orphans.length} unreachable file(s), baseline ${baseline.length}`);

if (added.length) {
  console.error('\nThese files are not reachable from any entry point, test, or config:\n');
  for (const a of added) console.error(`  ${a}`);
  console.error('\nEither delete them, or — if something reaches them in a way this check');
  console.error('cannot see (a runtime-built import path, a new convention directory) —');
  console.error('teach the resolver about it, or accept them with:');
  console.error('  node scripts/check-orphans.mjs --update');
  process.exit(1);
}

if (removed.length) {
  console.log(`\n${removed.length} baseline entry(s) are gone — lower the baseline:`);
  console.log('  node scripts/check-orphans.mjs --update');
  // Not a failure: nagging on an improvement is friendlier than blocking it.
}

console.log('orphan ratchet: no new unreachable files');
