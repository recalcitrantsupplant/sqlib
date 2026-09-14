#!/usr/bin/env node
/**
 * Install the tarball and compile against it, the way a stranger would.
 *
 * The publish lane has three gates and they ask three different questions.
 * `check-publishable.mjs` reads the manifest: is the metadata there, does every
 * `exports` target exist, is a `types` condition beside every JS condition with
 * the right extension. `check-public-api.mjs` reads the declarations: what
 * names does the tarball promise. Both read the *working tree* — the package
 * directory as it sits in the workspace, with `src/`, `test/` and
 * `node_modules/` beside the `dist/` a consumer would get.
 *
 * Nothing has ever installed one. That gap is not theoretical: a CommonJS
 * consumer getting `TS7016` from a package that ships declarations was found
 * by packing the tarball and typechecking against it *by hand*, and
 * the gate written afterwards checks the string `"./dist/index.d.cts"` rather
 * than whether a compiler can follow it. A `.d.cts` that exists and does not
 * compile passes; so does a public signature naming a type from a package that
 * is not a dependency — it resolves through pnpm's workspace links here and
 * nowhere else — and a file that `files` covers but the tarball somehow lacks.
 *
 * So this one packs each publishable package with `pnpm pack`, unpacks it into
 * a sandbox `node_modules`, writes a small consumer project against it, and
 * runs the compiler and Node over the result:
 *
 *   - **nodenext, ESM** — a `.ts` file in a `"type": "module"` project, which
 *     resolves the `import` condition and its `.d.ts`;
 *   - **nodenext, CJS** — a `.cts` file, which resolves the `require`
 *     condition and its `.d.cts`. This is the shape that was broken, and it is
 *     unreachable from inside the workspace because nothing here is CommonJS;
 *   - **bundler** — the resolution a static page's build actually uses, which
 *     is what these packages exist for.
 *
 * Then the same tarball is loaded, rather than only read: `require()` and
 * `import()` of **every** entry point the exports map declares, in a plain Node
 * process with no DOM, so an entry that typechecks and throws on load is not a
 * pass. That is not a hypothetical: `./args-element` and `./browser` both threw
 * `ReferenceError: HTMLElement is not defined` when this was first run, because
 * an `extends HTMLElement` clause is evaluated at load. Every host inside this
 * repository has a DOM — the app is `ssr: false`, the exported page is a
 * browser, the tests are happy-dom — so nothing here could have seen it, and a
 * consumer that server-renders would have seen it immediately.
 *
 * Finally three **canaries**, for the reason `check-generated-typings.mjs` has
 * one: a check that resolves nothing also reports success. Each takes a copy of
 * the real package, breaks it in the way one of the three paths above is meant
 * to catch, and requires that path to fail — removed `require` declarations must
 * produce `TS7016`, an injected import of a module the tarball does not depend
 * on must produce `TS2307`, and an entry point made to throw must be reported by
 * the load check. A pass there would mean the run above was reading something
 * other than the tarball.
 *
 * Legacy `moduleResolution: node10` is deliberately not among the configs:
 * typescript 7 removed the option (`TS5108`), so the compiler this repository
 * builds with cannot express that consumer at all. Whether the subpath exports
 * should also carry a `typesVersions` map for consumers on older compilers is a
 * manifest decision, and it belongs beside the others in the readiness note
 * rather than inside a gate that could not check it.
 *
 * Requires a build: the tarball is `dist/`. CI runs it from
 * scripts/ci/publish-check.sh, after build.sh.
 *
 * Usage: node scripts/check-installable.mjs [--keep]
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * What a consumer of each package is given to compile.
 *
 * Hand-written and deliberately small: this gate asks whether the package
 * resolves, not whether its API is right — `check-public-api.mjs` owns that —
 * so the sources reach for the entry points and a few names stable enough that
 * a rename would be a surface change anyway.
 *
 * `unloadable` is the escape hatch for an entry point that genuinely cannot be
 * loaded outside a browser, as a map of subpath to the reason why. It is empty,
 * and that is the finding rather than the default: the two entries that built a
 * custom element used to throw on import, and the fix was to stop evaluating
 * `HTMLElement` at load rather than to list them here.
 *
 * A publishable package with no entry here fails the run rather than being
 * skipped. Skipping is how a newly published package would arrive unchecked,
 * which is the failure this file exists to stop, one level up.
 */
const CONSUMERS = {
  '@sparql-query-lib/runtime': {
    unloadable: {},
    source: `import { fromBundle, iri, serializeTerm } from '@sparql-query-lib/runtime';
import type { QueryLibrary, TermValue } from '@sparql-query-lib/runtime';
import { defineArgsElement } from '@sparql-query-lib/runtime/args-element';
import { httpExecutor } from '@sparql-query-lib/runtime/browser';

// Every entry point of the exports map, reached by specifier: a subpath that
// resolves in the workspace and not in the tarball fails here.
const term: TermValue = iri('https://example.org/thing');
const rendered: string = serializeTerm(term, 'object');

declare const bundle: Parameters<typeof fromBundle>[0];
const library: QueryLibrary = fromBundle(bundle, {
  executor: httpExecutor('https://example.org/sparql'),
});

export { rendered, library, defineArgsElement };
`,
  },
  '@sparql-query-lib/runtime-oxigraph': {
    unloadable: {},
    source: `import { oxigraphExecutor } from '@sparql-query-lib/runtime-oxigraph';
import type { OxigraphExecutorOptions } from '@sparql-query-lib/runtime-oxigraph';
import { fromBundle } from '@sparql-query-lib/runtime';

declare const bundle: Parameters<typeof fromBundle>[0];

/*
 * The executor is handed straight to \`fromBundle\`, which is the one thing the
 * pair has to agree on: \`oxigraphExecutor\` returns the peer's \`Executor\`, and
 * the peer is resolved here through its own tarball. A declaration that named a
 * type only the workspace can see would fail on this line.
 */
export async function load(options: OxigraphExecutorOptions) {
  return fromBundle(bundle, { executor: await oxigraphExecutor(options) });
}
`,
  },
};

/**
 * The compiler configurations a consumer plausibly has.
 *
 * `cjs` decides the file extension rather than a compiler option: under
 * nodenext it is the extension that makes a file CommonJS, and therefore the
 * extension that decides which `exports` condition — and which declaration
 * file — the compiler resolves.
 */
const CONFIGS = [
  { name: 'nodenext, ESM consumer', module: 'nodenext', resolution: 'nodenext', cjs: false },
  { name: 'nodenext, CommonJS consumer', module: 'nodenext', resolution: 'nodenext', cjs: true },
  { name: 'bundler', module: 'esnext', resolution: 'bundler', cjs: false },
];

const keep = new Set(process.argv.slice(2)).has('--keep');

let failed = false;

function fail(message, detail) {
  console.error(`check-installable: ${message}`);
  if (detail) console.error(String(detail).replace(/^/gm, '  '));
  process.exit(1);
}

function report(context, detail) {
  failed = true;
  console.error(`check-installable: ${context}`);
  if (detail) console.error(String(detail).replace(/^/gm, '  '));
}

/** Every packages/* directory holding a package.json. */
function workspacePackages() {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(PACKAGES_DIR, entry.name, 'package.json')))
    .map((entry) => ({
      dir: path.join(PACKAGES_DIR, entry.name),
      manifest: readJson(path.join(PACKAGES_DIR, entry.name, 'package.json')),
    }));
}

/** The compiler a consumer would run, taken from the workspace. */
function findTsc() {
  const candidates = [
    path.join(PACKAGES_DIR, 'runtime', 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) fail('no typescript in the workspace — run `pnpm install` first');
  return found;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) return { status: 1, output: result.error.message };
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/** `pnpm pack` into the sandbox, and the tarball it wrote. */
function pack(name, destination) {
  mkdirSync(destination, { recursive: true });
  const before = new Set(readdirSync(destination));
  const packed = run('pnpm', ['--filter', name, 'pack', '--pack-destination', destination], {
    cwd: REPO_ROOT,
  });
  if (packed.status !== 0) fail(`pnpm pack failed for ${name}`, packed.output);

  const written = readdirSync(destination).filter((file) => file.endsWith('.tgz') && !before.has(file));
  if (written.length !== 1) {
    fail(`expected one new tarball for ${name}, got ${written.length ? written.join(', ') : 'none'}`);
  }
  return path.join(destination, written[0]);
}

/** Unpack `package/` out of the tarball into `into`. */
function unpack(tarball, into) {
  mkdirSync(into, { recursive: true });
  const extracted = run('tar', ['-xzf', tarball, '-C', into]);
  if (extracted.status !== 0) fail(`could not unpack ${path.basename(tarball)}`, extracted.output);
  const root = path.join(into, 'package');
  if (!existsSync(root)) fail(`${path.basename(tarball)} has no package/ directory`);
  return root;
}

/**
 * Where a dependency the tarball names comes from.
 *
 * Another publishable workspace package is resolved to its own unpacked
 * tarball — a peer is only really satisfied by what that peer publishes —
 * and anything else is linked from the copy pnpm already installed, which is
 * the version the lockfile pins.
 */
function dependencySource(name, unpacked, owner) {
  if (unpacked.has(name)) return unpacked.get(name);
  const installed = path.join(owner.dir, 'node_modules', name);
  if (!existsSync(installed)) {
    fail(
      `${owner.manifest.name} depends on ${name}, which is not installed at ` +
        `${path.relative(REPO_ROOT, installed)} — run \`pnpm install\` first`,
    );
  }
  return realpathSync(installed);
}

/** Lay out `node_modules` for one consumer project. */
function installInto(root, pkg, unpacked) {
  const modules = path.join(root, 'node_modules');
  const manifest = readJson(path.join(unpacked.get(pkg.manifest.name), 'package.json'));

  const link = (name, from) => {
    const target = path.join(modules, name);
    mkdirSync(path.dirname(target), { recursive: true });
    if (existsSync(target)) return;
    // The package under test is copied rather than linked: the canary mutates
    // it, and a mutation that reached the shared unpacked copy would leak into
    // the runs after it.
    if (name === pkg.manifest.name) cpSync(from, target, { recursive: true });
    else symlinkSync(from, target, 'dir');
  };

  link(pkg.manifest.name, unpacked.get(pkg.manifest.name));
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      link(name, dependencySource(name, unpacked, pkg));
    }
  }
  return modules;
}

/** One consumer project: the package installed, a source file, a tsconfig. */
function writeProject(root, pkg, unpacked, config) {
  mkdirSync(root, { recursive: true });
  installInto(root, pkg, unpacked);

  const usage = config.cjs ? 'usage.cts' : 'usage.ts';
  writeFileSync(path.join(root, usage), CONSUMERS[pkg.manifest.name].source);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'sqlib-install-consumer',
        private: true,
        version: '0.0.0',
        // A `.cts` file is CommonJS whatever the project's type, so the module
        // system under test is the extension's rather than this field's; it is
        // ESM throughout so that the ESM run is the ordinary case it is meant
        // to be.
        type: 'module',
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'es2022',
          // `dom` because these packages are for a page; without it the
          // args-element declarations would fail for a reason about this
          // project rather than about the tarball.
          lib: ['es2022', 'dom'],
          module: config.module,
          moduleResolution: config.resolution,
          strict: true,
          noEmit: true,
          // Off, and that is the point: the published declarations are exactly
          // what this gate is here to compile.
          skipLibCheck: false,
          types: [],
        },
        include: [usage],
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

function compile(tsc, root) {
  const result = run(process.execPath, [tsc, '--project', path.join(root, 'tsconfig.json')]);
  if (result.status === 0) return '';
  return result.output === '' ? `tsc exited ${result.status} with no output` : result.output;
}

/**
 * Every specifier a consumer can import, from the packed exports map.
 *
 * `./package.json` is excluded because it is data rather than a module, and so
 * is any subpath whose conditions name no JavaScript — a map that exported only
 * types would otherwise report a module that cannot be loaded at all.
 */
function entryPoints(name, manifest) {
  const isJs = (node) => {
    if (typeof node === 'string') return /\.(?:js|cjs|mjs)$/.test(node);
    if (node === null || typeof node !== 'object') return false;
    return Object.entries(node).some(([key, value]) => key !== 'types' && isJs(value));
  };

  return Object.entries(manifest.exports ?? {})
    .filter(([subpath, node]) => subpath !== './package.json' && isJs(node))
    .map(([subpath]) => ({ subpath, specifier: subpath === '.' ? name : `${name}/${subpath.slice(2)}` }));
}

/** `require()` and `import()` of one specifier, from inside the project. */
function load(root, specifier) {
  const problems = [];
  const required = run(process.execPath, ['-e', `require(${JSON.stringify(specifier)})`], { cwd: root });
  if (required.status !== 0) problems.push(`require('${specifier}') failed:\n${required.output}`);

  const imported = run(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`],
    { cwd: root },
  );
  if (imported.status !== 0) problems.push(`import('${specifier}') failed:\n${imported.output}`);
  return problems;
}

/**
 * The declarations the `require` condition names, as paths inside the package.
 *
 * Read from the packed manifest rather than guessed, so the canary removes
 * what this package actually promises a CommonJS consumer.
 */
function requireDeclarations(manifest) {
  const found = [];
  const walk = (node, inRequire) => {
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        if (inRequire && key === 'types') found.push(value.replace(/^\.\//, ''));
        continue;
      }
      walk(value, inRequire || key === 'require');
    }
  };
  walk(manifest.exports ?? {}, false);
  return found;
}

// --- the run ----------------------------------------------------------------

const tsc = findTsc();
const packages = workspacePackages();
const publishable = packages.filter((pkg) => pkg.manifest.private !== true);

// Same discipline as the other gates: a check with nothing to check must fail
// rather than pass vacuously.
if (publishable.length === 0) {
  fail(
    'no publishable packages in packages/* — every one is `private: true`.\n' +
      'If npm publishing was withdrawn, remove this gate deliberately.',
  );
}

for (const pkg of publishable) {
  if (!CONSUMERS[pkg.manifest.name]) {
    fail(
      `${pkg.manifest.name} is publishable and has no consumer in scripts/check-installable.mjs.\n` +
        'Add one — a package nobody compiles against is a package nobody has installed.',
    );
  }
}

const sandbox = mkdtempSync(path.join(tmpdir(), 'sqlib-install-'));

try {
  // --- pack, unpack, and read what was actually published -------------------
  const unpacked = new Map();
  for (const pkg of publishable) {
    const tarball = pack(pkg.manifest.name, path.join(sandbox, 'tarballs'));
    const root = unpack(tarball, path.join(sandbox, 'unpacked', pkg.manifest.name.replace('/', '+')));
    unpacked.set(pkg.manifest.name, root);

    const packedManifest = readJson(path.join(root, 'package.json'));
    // pnpm rewrites `workspace:` ranges on the way out. The readiness note
    // records that it does; this is the run that sees it, and a range that
    // survived would publish a tarball nobody can install.
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
      for (const [name, range] of Object.entries(packedManifest[field] ?? {})) {
        if (String(range).startsWith('workspace:')) {
          report(
            `${pkg.manifest.name}: packed ${field}."${name}" is still "${range}"`,
            'The workspace protocol was not rewritten at pack time — the tarball is uninstallable.',
          );
        }
      }
    }
  }

  // --- compile a consumer, per module system --------------------------------
  for (const pkg of publishable) {
    for (const [index, config] of CONFIGS.entries()) {
      const root = path.join(sandbox, 'projects', `${pkg.manifest.name.replace('/', '+')}-${index}`);
      writeProject(root, pkg, unpacked, config);
      const output = compile(tsc, root);
      if (output === '') {
        console.log(`check-installable: ${pkg.manifest.name} — ${config.name} ok`);
        continue;
      }
      report(`${pkg.manifest.name} — ${config.name}`, output);
    }
  }

  // --- load it, rather than only compiling against it -----------------------
  //
  // In a plain Node process, which has no DOM: an entry point that needs one to
  // be *loaded* rather than to be *used* is broken for every consumer that
  // renders on a server, and that is a majority of the page frameworks these
  // packages exist for.
  for (const pkg of publishable) {
    const root = path.join(sandbox, 'projects', `${pkg.manifest.name.replace('/', '+')}-0`);
    const packedManifest = readJson(path.join(unpacked.get(pkg.manifest.name), 'package.json'));
    const { unloadable } = CONSUMERS[pkg.manifest.name];

    const entries = entryPoints(pkg.manifest.name, packedManifest);
    if (entries.length === 0) {
      report(`${pkg.manifest.name} — entry points`, 'the packed exports map names no JavaScript entry');
      continue;
    }

    for (const { subpath, specifier } of entries) {
      if (unloadable[subpath]) {
        console.log(`check-installable: ${specifier} — not loaded (${unloadable[subpath]})`);
        continue;
      }
      const problems = load(root, specifier);
      if (problems.length === 0) {
        console.log(`check-installable: ${specifier} — loads under require() and import()`);
        continue;
      }
      for (const problem of problems) report(`${pkg.manifest.name} — ${subpath}`, problem);
    }
  }

  // --- the canaries ---------------------------------------------------------
  //
  // One per way this gate can read a package: the CommonJS declaration
  // resolution, the compile, and the load. A run that resolved nothing would
  // report the same success as a run that resolved everything, so each of the
  // three is asked to fail on a copy of the real package, deliberately broken
  // in the way that path is supposed to catch.
  //
  // This is why there are no fixtures in `ratchet-selftest.sh`: a synthetic
  // package could only prove the gate catches a defect in a synthetic package.
  // These prove it catches one in the tarball actually under test, on every
  // run rather than when someone remembers to look.
  for (const pkg of publishable) {
    const name = pkg.manifest.name;
    const packedManifest = readJson(path.join(unpacked.get(name), 'package.json'));
    const cjsConfig = CONFIGS.find((config) => config.cjs);
    const esmConfig = CONFIGS.find((config) => !config.cjs);
    const canaryRoot = (label) => path.join(sandbox, 'canary', `${name.replace('/', '+')}-${label}`);
    const installed = (root, file) => path.join(root, 'node_modules', name, file);

    // 1. CommonJS declarations. Remove what the `require` condition names: a
    //    consumer then has JavaScript with no types, which is the TS7016 the
    //    readiness note's §2 is written about.
    const declarations = requireDeclarations(packedManifest);
    if (declarations.length === 0) {
      report(
        `${name} — canary`,
        'the packed exports map names no `require` → `types` file, so a CommonJS consumer has no declarations at all',
      );
    } else {
      const root = canaryRoot('types');
      writeProject(root, pkg, unpacked, cjsConfig);
      for (const declaration of declarations) rmSync(installed(root, declaration), { force: true });

      const output = compile(tsc, root);
      if (output === '') {
        report(
          `${name} — canary: CommonJS declarations`,
          `Removing ${declarations.join(', ')} should leave a CommonJS consumer with no declarations,\n` +
            'so the CJS run above is resolving types through some other path and proves nothing.',
        );
      } else if (!output.includes('TS7016')) {
        report(
          `${name} — canary: CommonJS declarations, wrong failure`,
          `Expected TS7016 (no declaration file) once the require declarations are gone.\n${output}`,
        );
      } else {
        console.log(`check-installable: ${name} — canary: CommonJS declarations rejected as they should be`);
      }
    }

    // 2. The compile. A type from a module the tarball does not depend on
    //    resolves inside this workspace and nowhere else, so a consumer's
    //    compiler is the only thing that can report it.
    const entryTypes = (packedManifest.exports?.['.']?.import?.types ?? packedManifest.types ?? '').replace(
      /^\.\//,
      '',
    );
    if (!entryTypes) {
      report(`${name} — canary`, 'the packed manifest names no declaration file for the `.` entry');
    } else {
      const root = canaryRoot('compile');
      writeProject(root, pkg, unpacked, esmConfig);
      const declarationFile = installed(root, entryTypes);
      writeFileSync(
        declarationFile,
        `import type { Absent } from 'a-package-this-tarball-does-not-depend-on';\n` +
          `export type CanaryProbe = Absent;\n${readFileSync(declarationFile, 'utf8')}`,
      );

      const output = compile(tsc, root);
      if (output === '') {
        report(
          `${name} — canary: undeclared dependency`,
          `A type imported from a module ${name} does not depend on should not compile.\n` +
            'The consumer project is not reading the published declarations, so the compiles above prove nothing.',
        );
      } else if (!output.includes('TS2307')) {
        report(
          `${name} — canary: undeclared dependency, wrong failure`,
          `Expected TS2307 (cannot find module) from the injected import.\n${output}`,
        );
      } else {
        console.log(`check-installable: ${name} — canary: undeclared dependency rejected as it should be`);
      }
    }

    // 3. The load. An entry point that throws when it is imported — the shape
    //    `extends HTMLElement` had outside a browser — must be reported rather
    //    than passed over.
    const entries = entryPoints(name, packedManifest);
    const loadable = entries.find(({ subpath }) => !CONSUMERS[name].unloadable[subpath]);
    if (!loadable) {
      report(`${name} — canary`, 'no entry point is loaded, so the load check proves nothing');
    } else {
      const root = canaryRoot('load');
      writeProject(root, pkg, unpacked, esmConfig);
      const targets = new Set(
        ['import', 'require']
          .map((condition) => packedManifest.exports?.[loadable.subpath]?.[condition]?.default)
          .filter(Boolean)
          .map((target) => target.replace(/^\.\//, '')),
      );
      for (const target of targets) {
        writeFileSync(
          installed(root, target),
          `throw new Error('check-installable canary');\n${readFileSync(installed(root, target), 'utf8')}`,
        );
      }

      const problems = targets.size === 0 ? [] : load(root, loadable.specifier);
      if (problems.length === 0) {
        report(
          `${name} — canary: entry point that throws`,
          `${loadable.specifier} was made to throw on import and the load check did not notice.` +
            (targets.size === 0 ? '\nIts exports entry names no `default` target to break.' : ''),
        );
      } else {
        console.log(`check-installable: ${name} — canary: a throwing entry point rejected as it should be`);
      }
    }
  }
} finally {
  if (keep) console.log(`check-installable: sandbox kept at ${sandbox}`);
  else rmSync(sandbox, { recursive: true, force: true });
}

if (failed) {
  console.error('');
  console.error('The tarball these packages would publish did not install and compile as a consumer');
  console.error("compiles it. Nothing inside the workspace resolves a package the way npm does, so a");
  console.error('failure here is invisible everywhere else. Re-run with --keep to inspect the projects.');
  process.exit(1);
}
