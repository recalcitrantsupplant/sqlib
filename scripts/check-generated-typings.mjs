#!/usr/bin/env node
/**
 * Compile the declaration `sqlib export --typings` writes, the way a consumer
 * compiles it.
 *
 * `scripts/check-publishable.mjs` asks whether the manifest is right,
 * `scripts/check-installable.mjs` whether the tarball installs, and
 * `scripts/check-public-api.mjs` what is in it. This asks a question about an
 * artifact that is not in the tarball at all: the `.d.json.ts` the export
 * writes beside a bundle, which exists only in a consumer's project and is
 * handed to a compiler we do not run.
 *
 * Nothing in this repository compiled one. `derivedOutputs.test.ts` freezes its
 * bytes and checks that the names it reaches into `@sparql-query-lib/runtime`
 * for are on the published surface, but a declaration can pass both and still
 * be rejected by every tsc that reads it, which is what was happening. The
 * failure is invisible from inside the workspace by construction: the artifact's only
 * consumer is somebody else's build.
 *
 * So this builds a project shaped like that consumer's — the frozen bundle as
 * `queries.json`, the generated declaration beside it, the runtime resolved
 * through `node_modules` — and runs tsc over it once per module-resolution
 * shape a consumer plausibly has. Two directions are checked, because a
 * declaration that types nothing also compiles:
 *
 *   - the usage files must compile clean, and their `@ts-expect-error` lines
 *     must each report an error (tsc fails an unused directive), so a
 *     misspelt query name staying legal is a failure here;
 *   - a canary run compiles a deliberately mutated declaration and must fail,
 *     which is what proves the declaration is being consulted rather than the
 *     raw JSON's inferred type.
 *
 * Requires a build: it generates through `packages/api/dist` and resolves the
 * runtime's built declarations. CI runs it from scripts/ci/publish-check.sh,
 * after build.sh.
 *
 * Usage: node scripts/check-generated-typings.mjs [--keep]
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = path.join(REPO_ROOT, 'packages', 'runtime');
const TYPINGS_MODULE = path.join(REPO_ROOT, 'packages', 'api', 'dist', 'lib', 'export', 'typings.js');

/**
 * The bundle the declaration is generated from: the frozen fixture the
 * bundle-format pass produced, chosen because every optional field in the
 * format appears somewhere in it.
 */
const BUNDLE_FIXTURE = path.join(RUNTIME_DIR, 'test', 'fixtures', 'bundle-v1.json');

/** The JSON's name in the consumer project, and therefore the declaration's. */
const BUNDLE_FILE = 'queries.json';

/**
 * The consumer configurations. `moduleResolution` decides two things this
 * artifact cares about — whether the `.d.json.ts` is consulted at all, and
 * whether named imports from a JSON module are legal — and `resolveJsonModule`
 * is the setting most likely to be already on in a project that imports JSON,
 * so both values of it are checked rather than assumed to be equivalent.
 *
 * `skipLibCheck` stays off: the runtime's own published declarations are part
 * of what a consumer compiles, and this is a publish gate.
 */
const CONFIGS = [
  { name: 'nodenext, resolveJsonModule on', module: 'nodenext', resolution: 'nodenext', json: true },
  { name: 'nodenext, resolveJsonModule off', module: 'nodenext', resolution: 'nodenext', json: false },
  { name: 'bundler, resolveJsonModule on', module: 'esnext', resolution: 'bundler', json: true },
  { name: 'bundler, resolveJsonModule off', module: 'esnext', resolution: 'bundler', json: false },
];

/**
 * What every consumer can write, whatever their resolution.
 *
 * NodeNext forbids a named import from a JSON module, so the query names are
 * reached here through `typeof bundle` — the spelling the generated header
 * recommends — rather than by importing `QueryName`.
 */
const USAGE_UNIVERSAL = `import bundle from './${BUNDLE_FILE}' with { type: 'json' };
import { fromBundle, iri, type ArgumentRow, type QueryLibrary } from '@sparql-query-lib/runtime';

type QueryName = keyof typeof bundle.queries;

// The declaration's whole promise: this call is typed by the bundle's own names.
const lib = fromBundle(bundle);
lib.query('people-by-city');

// The fields of the JSON are reachable, so the import is the bundle and not a
// namespace that merely happens to satisfy \`fromBundle\`.
const library: string = bundle.library.id;
const named: QueryName = 'labels';
console.log(library, named);

// @ts-expect-error a name the bundle does not carry
lib.query('not-a-query');

// @ts-expect-error and the same when the name is only nearly right
lib.query('people-by-cities');

/*
 * The short form's rows are typed too: a cell is a SPARQL Results JSON term,
 * a blank cell is null or absent, and a whole null row is a blank row. The
 * negative case is the point — a bare string reads like an IRI and is not one,
 * and before the short form named ArgumentRow the compiler had nothing to say.
 */
const row: ArgumentRow = { city: iri('http://example.org/perth'), year: null };
lib.query('people-by-city').text({ arguments: [{ bindings: [row, null] }] });

// @ts-expect-error a bare string is not a term — \`iri('…')\` or \`literal('…')\` is
lib.query('people-by-city').text({ arguments: [{ bindings: [{ city: 'http://example.org/perth' }] }] });

/** The other consumption path: a bundle fetched at runtime, named by its type. */
async function fetched(): Promise<QueryLibrary<QueryName>> {
  const response = await fetch('https://example.org/${BUNDLE_FILE}');
  return fromBundle<QueryName>(await response.json());
}
void fetched;
`;

/**
 * What only a bundler-resolution consumer can write. The types the declaration
 * exports are reachable by name there; under NodeNext the same import is
 * TS1544, which is why this file is compiled in only two of the four configs.
 */
const USAGE_NAMED_TYPES = `import type { Bundle, QueryCatalogue, QueryName } from './${BUNDLE_FILE}';

const name: QueryName = 'labels';
const inputs: QueryCatalogue['people-by-city']['inputs'] = [['city']];
declare const loaded: Bundle;
console.log(name, inputs, loaded.library.id);

// @ts-expect-error 'city' is the only variable that slot takes
const wrong: QueryCatalogue['people-by-city']['inputs'] = [['region']];
void wrong;
`;

const args = new Set(process.argv.slice(2));
const keep = args.has('--keep');

function fail(message, detail) {
  console.error(`check-generated-typings: ${message}`);
  if (detail) console.error(detail.replace(/^/gm, '  '));
  process.exit(1);
}

/** The compiler a consumer would run, taken from the workspace. */
function findTsc() {
  const candidates = [
    path.join(RUNTIME_DIR, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Lay out one consumer project: the JSON, its declaration, and the usage. */
function writeProject(root, { bundleText, declarationName, declaration, files, config }) {
  mkdirSync(path.join(root, 'node_modules', '@sparql-query-lib'), { recursive: true });
  symlinkSync(RUNTIME_DIR, path.join(root, 'node_modules', '@sparql-query-lib', 'runtime'), 'dir');

  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'sqlib-typings-consumer',
    private: true,
    version: '0.0.0',
    type: 'module',
  }, null, 2)}\n`);

  writeFileSync(path.join(root, BUNDLE_FILE), bundleText);
  writeFileSync(path.join(root, declarationName), declaration);
  for (const [name, source] of Object.entries(files)) writeFileSync(path.join(root, name), source);

  writeFileSync(path.join(root, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'es2022',
      lib: ['es2022', 'dom'],
      module: config.module,
      moduleResolution: config.resolution,
      resolveJsonModule: config.json,
      allowArbitraryExtensions: true,
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: [],
    },
    include: [declarationName, ...Object.keys(files)],
  }, null, 2)}\n`);
}

/** Compile one project. Returns tsc's own report, or '' when it is clean. */
function compile(root) {
  const result = spawnSync(process.execPath, [tsc, '--project', path.join(root, 'tsconfig.json')], {
    encoding: 'utf8',
  });
  if (result.error) fail(`could not run tsc: ${result.error.message}`);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0 && output === '') return `tsc exited ${result.status} with no output`;
  return result.status === 0 ? '' : output;
}

// --- inputs -----------------------------------------------------------------

const tsc = findTsc();
if (!tsc) fail('no typescript in the workspace — run `pnpm install` first');
if (!existsSync(TYPINGS_MODULE)) {
  fail(`no ${path.relative(REPO_ROOT, TYPINGS_MODULE)} — build first (scripts/ci/build.sh)`);
}
if (!existsSync(path.join(RUNTIME_DIR, 'dist', 'index.d.ts'))) {
  fail('packages/runtime/dist/index.d.ts is missing — build first (scripts/ci/build.sh)');
}
if (!existsSync(BUNDLE_FIXTURE)) fail(`no bundle fixture at ${path.relative(REPO_ROOT, BUNDLE_FIXTURE)}`);

const { generateBundleTypings, bundleTypingsFileName } = await import(
  pathToFileURL(TYPINGS_MODULE).href
);

const bundleText = readFileSync(BUNDLE_FIXTURE, 'utf8');
const bundle = JSON.parse(bundleText);
const specifier = `./${BUNDLE_FILE}`;
const declarationName = bundleTypingsFileName(specifier);
const declaration = generateBundleTypings(bundle, specifier);

// A bundle with no queries would compile clean and prove nothing about names.
const queryNames = Object.keys(bundle.queries ?? {});
if (queryNames.length === 0) {
  fail(`${path.relative(REPO_ROOT, BUNDLE_FIXTURE)} carries no queries — nothing to type`);
}
for (const required of ['people-by-city', 'labels']) {
  if (!queryNames.includes(required)) {
    fail(`the fixture no longer carries '${required}', which the usage files call by name`);
  }
}

const sandbox = mkdtempSync(path.join(tmpdir(), 'sqlib-typings-'));
let failed = false;

try {
  for (const [index, config] of CONFIGS.entries()) {
    const files = { 'usage.ts': USAGE_UNIVERSAL };
    if (config.resolution === 'bundler') files['named-types.ts'] = USAGE_NAMED_TYPES;

    const root = path.join(sandbox, `config-${index}`);
    mkdirSync(root);
    writeProject(root, { bundleText, declarationName, declaration, files, config });

    const report = compile(root);
    if (report === '') {
      console.log(`check-generated-typings: ${config.name} ok`);
      continue;
    }
    failed = true;
    console.error(`check-generated-typings: ${config.name}`);
    console.error(report.replace(/^/gm, '  '));
  }

  // The canary. A run that reads the raw JSON instead of the declaration, or
  // that silently compiles nothing, passes everything above; renaming a query
  // inside the declaration is a failure only a consulted declaration produces.
  const canaryRoot = path.join(sandbox, 'canary');
  mkdirSync(canaryRoot);
  const mutated = declaration.replaceAll("'people-by-city'", "'people-by-citee'");
  if (mutated === declaration) fail('canary could not mutate the declaration — has the shape changed?');
  writeProject(canaryRoot, {
    bundleText,
    declarationName,
    declaration: mutated,
    files: { 'usage.ts': USAGE_UNIVERSAL },
    config: CONFIGS[0],
  });
  if (compile(canaryRoot) === '') {
    failed = true;
    console.error('check-generated-typings: canary compiled clean');
    console.error('  A declaration naming no query the usage calls should not typecheck.');
    console.error('  The consumer project is resolving something other than the declaration,');
    console.error('  so the checks above are passing without reading it.');
  } else {
    console.log('check-generated-typings: canary rejected as it should be');
  }
} finally {
  if (keep) console.log(`check-generated-typings: project kept at ${sandbox}`);
  else rmSync(sandbox, { recursive: true, force: true });
}

if (failed) {
  console.error('');
  console.error('The declaration `sqlib export --typings` writes did not compile as a consumer');
  console.error('compiles it. It is generated by packages/api/src/lib/export/typings.ts; its bytes');
  console.error('are frozen by packages/api/test/lib/export/derivedOutputs.test.ts, so a fix there');
  console.error('is a golden update as well. Re-run with --keep to inspect the project.');
  process.exit(1);
}
