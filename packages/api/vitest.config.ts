import fs from 'node:fs';
import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

/*
 * Which test files may share a module registry.
 *
 * Isolation re-evaluates the whole source graph (~900 modules) for every file,
 * which is most of what a file costs when it is not doing much else (#30).
 * Files that run without it share one registry per worker, and
 * test/setup-shared-registry.ts resets the app's singletons before each so
 * they still start clean.
 *
 * What a reset cannot undo is `vi.mock`: vitest keeps its mock registry across
 * files when isolation is off, and a module evaluated against one file's mock
 * keeps that binding for every file after. So any file that mocks a module —
 * itself or through a helper it imports — stays isolated, as does anything
 * importing the server entry point. Nothing to maintain: this is worked out
 * from the files on every run.
 */
const MOCKS = /\bvi\.(?:do)?[mM]ock\(/;
/*
 * The server entry point. Importing it installs process-exit handlers and
 * starts the OpenTelemetry SDK process-wide, neither of which a reset undoes.
 */
const ENTRY_POINT = /['"](?:\.\.\/)+src\/index(?:\.js)?['"]/;
// `from '…'`, a bare `import '…'`, and `import('…')`.
const RELATIVE_IMPORT = /\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

function listTestSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTestSources(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * Test files that call `vi.mock` or import the entry point, directly or
 * anywhere in their test/ imports.
 */
function mockingTestFiles(): string[] {
  const texts = new Map(
    listTestSources(path.resolve(__dirname, 'test')).map(file => [file, fs.readFileSync(file, 'utf8')]),
  );
  const imports = (file: string) =>
    [...texts.get(file)!.matchAll(RELATIVE_IMPORT)]
      .map(match => path.resolve(path.dirname(file), match[1].replace(/\.js$/, '')))
      .map(target => (texts.has(`${target}.ts`) ? `${target}.ts` : target))
      .filter(target => texts.has(target));
  const mocking = new Set(
    [...texts.keys()].filter(file => MOCKS.test(texts.get(file)!) || ENTRY_POINT.test(texts.get(file)!)),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const file of texts.keys()) {
      if (!mocking.has(file) && imports(file).some(target => mocking.has(target))) {
        mocking.add(file);
        grew = true;
      }
    }
  }
  return [...mocking]
    .filter(file => file.endsWith('.test.ts'))
    .map(file => path.relative(__dirname, file).split(path.sep).join('/'));
}

const isolatedFiles = mockingTestFiles();

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // `include` is per project, below.
    alias: [
      { find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' },
      // Must precede the bare `contracts` entry: vite matches string `find`s by
      // prefix, so the shorter one would rewrite `contracts/schema` into
      // `<contracts/src/index.ts>/schema`.
      {
        find: '@sparql-query-lib/contracts/iri',
        replacement: path.resolve(__dirname, '../contracts/src/iri.ts'),
      },
      {
        find: '@sparql-query-lib/contracts/schema/routes',
        replacement: path.resolve(__dirname, '../contracts/src/schema/routes.ts'),
      },
      {
        find: '@sparql-query-lib/contracts/schema',
        replacement: path.resolve(__dirname, '../contracts/src/schema/index.ts'),
      },
      {
        find: '@sparql-query-lib/contracts',
        replacement: path.resolve(__dirname, '../contracts/src/index.ts'),
      },
      {
        find: '@sparql-query-lib/types',
        replacement: path.resolve(__dirname, '../types/src/index.ts'),
      },
      {
        find: '@sparql-query-lib/srl',
        replacement: path.resolve(__dirname, '../srl/src/index.ts'),
      },
      {
        find: '@sparql-query-lib/tools',
        replacement: path.resolve(__dirname, '../tools/src/index.ts'),
      },
      {
        find: '@sparql-query-lib/runtime',
        replacement: path.resolve(__dirname, '../runtime/src/index.ts'),
      },
      {
        find: '@sparql-query-lib/rdf-delta',
        replacement: path.resolve(__dirname, '../rdf-delta/src/index.ts'),
      },
    ],
    setupFiles: ['./test/setup-vitest.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'shared',
          isolate: false,
          include: ['test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...isolatedFiles],
          setupFiles: ['./test/setup-shared-registry.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'isolated',
          include: isolatedFiles,
        },
      },
    ],
    // Ensures packages/runtime is built: a few tests inline its CommonJS bundle,
    // and CI's test job installs without building. See test/global-setup.ts.
    globalSetup: ['./test/global-setup.ts'],
    // On the in-process oxigraph backends every test file gets its own store
    // (fresh modules, or the reset in setup-shared-registry.ts), so files are
    // independent and run concurrently. An `http` backend is a single
    // shared dataset, so concurrent files see each other's writes — which silently
    // invalidates any assertion about store *state* rather than just failing
    // honestly. See test/persistence/README-http-backend.md.
    fileParallelism: process.env.INTERNAL_BACKEND_TYPE !== 'http',
    coverage: {
      enabled: process.env.VITEST_COVERAGE === 'true',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**'],
    },
  },
});
