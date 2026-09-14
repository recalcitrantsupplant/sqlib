/**
 * The three derived outputs are compatibility surfaces too.
 *
 * The bundle-format compatibility rule pinned the bundle: the JSON one version
 * writes and another version reads. `demoPage.ts`, `typings.ts` and
 * `notebook.ts` each turn that bundle into a *different* artifact — an HTML
 * page, a `.d.ts`, an `.ipynb` — and a consumer keeps and diffs those, hands
 * them to tools we do not own, and regenerates them against a later version of
 * this server. So each has a contract of its own, and none of it was written
 * down.
 *
 * Two kinds of check live here, and they fail for different reasons:
 *
 * 1. **The bytes are frozen.** Each output is rebuilt from one fixture library
 *    and compared to a committed golden, so any change to what we emit arrives
 *    as a reviewed diff rather than as somebody's broken regeneration. Update
 *    them deliberately:
 *
 *        UPDATE_EXPORT_GOLDENS=1 pnpm --filter @sparql-query-lib/api test derivedOutputs
 *
 * 2. **The names that cross a package boundary are checked against the
 *    published surface**, not against the workspace. The declaration imports a
 *    type from `@sparql-query-lib/runtime`, and the page calls methods on the
 *    global its browser build publishes. Both are resolved by the *consumer*
 *    against a published package, so the list they are checked against is
 *    `packages/runtime/public-api.md` — the report `scripts/check-public-api.mjs`
 *    generates from the built declarations. Inside the workspace a rename there
 *    breaks nothing here: the page's tests inject a stub runtime, and this suite
 *    reads the declaration as text.
 *
 * Compiling the declaration is the check this suite cannot make — it needs a
 * built runtime, a project laid out as a consumer's, and a tsc subprocess. That
 * is `scripts/check-generated-typings.mjs`, in the publish-check lane after
 * build.sh. The two are complementary: this pins what we emit, that pins that
 * what we emit typechecks.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateDemoPage } from '../../../src/lib/export/demoPage.js';
import { generateNotebook } from '../../../src/lib/export/notebook.js';
import { bundleTypingsFileName, generateBundleTypings } from '../../../src/lib/export/typings.js';
import {
  buildFixtureBundle,
  FIXTURE_QUERIES,
  FIXTURE_SKIPPED,
} from './fixtures/derivedOutputsLibrary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, 'fixtures', 'derived-outputs');
const PUBLIC_API_REPORT = join(HERE, '..', '..', '..', '..', 'runtime', 'public-api.md');

/**
 * The page inlines the runtime's built browser bundle, which changes on every
 * runtime build. Freezing those bytes would pin a minified artifact and fail on
 * rebuilds that change nothing about the page, so the golden carries a stub in
 * its place: what is frozen is the page we generate, including the seam that
 * evaluates the runtime and publishes it as `window.SQLIB`.
 */
const RUNTIME_STUB = 'module.exports = { stub: true };';

/** The module specifier a consumer imports the bundle JSON as. */
const MODULE_SPECIFIER = './queries.json';

function golden(name: string): string {
  return readFileSync(join(GOLDEN_DIR, name), 'utf8');
}

/** Compare against the committed artifact, or rewrite it when asked to. */
function expectGolden(name: string, actual: string): void {
  if (process.env.UPDATE_EXPORT_GOLDENS) {
    writeFileSync(join(GOLDEN_DIR, name), actual);
    return;
  }
  expect(actual).toBe(golden(name));
}

async function outputs() {
  const bundle = await buildFixtureBundle();
  return {
    bundle,
    page: generateDemoPage(bundle, { skipped: FIXTURE_SKIPPED, runtimeSource: RUNTIME_STUB }),
    typings: generateBundleTypings(bundle, MODULE_SPECIFIER),
    notebook: generateNotebook(bundle, { skipped: FIXTURE_SKIPPED }),
  };
}

// --- the published surface --------------------------------------------------

/**
 * Read the names one entry point of `public-api.md` exports.
 *
 * The report writes a name two ways: as a `### \`name\` — kind, from \`module\``
 * heading for an entry point that declares it, and inside a "re-exported
 * unchanged" sentence for one that passes it through. `./browser` is entirely
 * the second kind, which is why both are read.
 */
function publishedNames(entryPoint: string): Set<string> {
  const report = readFileSync(PUBLIC_API_REPORT, 'utf8');
  const sections = report.split(/^## /m);
  const section = sections.find((part) => part.startsWith(`\`${entryPoint}\``));
  if (!section) throw new Error(`public-api.md has no section for ${entryPoint}`);

  const names = new Set<string>();
  for (const match of section.matchAll(/^### `([^`]+)`/gm)) names.add(match[1]);

  const reexports = section.match(/re-exported unchanged from an entry point above: ([^.]+)\./);
  if (reexports) {
    for (const match of reexports[1].matchAll(/`([^`]+)`/g)) names.add(match[1]);
  }
  return names;
}

// --- nbformat 4.5 -----------------------------------------------------------
//
// Checked against the published schema rather than against a reading of it:
// https://github.com/jupyter/nbformat/blob/main/nbformat/v4/nbformat.v4.5.schema.json
// A notebook is JSON that a validator we do not own accepts or rejects, so the
// rules are transcribed here at the granularity the schema states them.

const NOTEBOOK_REQUIRED = ['metadata', 'nbformat_minor', 'nbformat', 'cells'];
const CELL_REQUIRED = ['id', 'cell_type', 'metadata', 'source'];
const CODE_CELL_REQUIRED = [...CELL_REQUIRED, 'outputs', 'execution_count'];
const CELL_ID = /^[a-zA-Z0-9-_]+$/;

describe('the derived outputs are frozen', () => {
  it('emits the demo page it emitted last time', async () => {
    expectGolden('demo-page.html', (await outputs()).page);
  });

  it('emits the declaration it emitted last time', async () => {
    expectGolden('bundle-typings.d.json.ts.golden', (await outputs()).typings);
  });

  it('emits the notebook it emitted last time', async () => {
    expectGolden('notebook.ipynb', (await outputs()).notebook);
  });

  it('exercises every branch the goldens are supposed to cover', async () => {
    // A fixture that quietly stops covering a branch leaves a golden that
    // passes while testing less every year — the failure #408 found in the
    // bundle's own coverage check, in the shape it takes here.
    const { bundle } = await outputs();
    const queries = Object.values(bundle.queries);
    expect(FIXTURE_SKIPPED.length).toBeGreaterThan(0);
    expect(queries.some((query) => query.examples && query.examples.length > 0)).toBe(true);
    expect(queries.some((query) => !query.examples || query.examples.length === 0)).toBe(true);
    expect(queries.some((query) => query.description)).toBe(true);
    expect(queries.some((query) => !query.description)).toBe(true);
    expect(queries.some((query) => query.inferredInputs.length > 0)).toBe(true);
    expect(queries.some((query) => query.inferredInputs.length === 0)).toBe(true);
    expect(queries.some((query) => query.limitParameters.length > 0)).toBe(true);
    expect(queries.some((query) => query.offsetParameters.length > 0)).toBe(true);
    expect(queries.some((query) => query.queryType !== 'SELECT')).toBe(true);
    expect(queries.some((query) => query.sourceVersion)).toBe(true);

    // The group branch: the page draws a cell for one, and the chain it draws
    // needs an edge to have anything to say. The other two outputs describe
    // queries only, so this moves the page golden alone — which is the point of
    // covering it here rather than in a page-only fixture.
    const groups = Object.values(bundle.groups ?? {});
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.some((group) => group.edges.length > 0)).toBe(true);
    expect(
      groups.some((group) =>
        group.edges.some((edge) =>
          edge.mappings.some((mapping) => mapping.source !== mapping.target),
        ),
      ),
    ).toBe(true);
  });
});

describe('the notebook is a valid nbformat 4.5 document', () => {
  it('carries the top-level fields the schema requires', async () => {
    const notebook = JSON.parse((await outputs()).notebook);
    for (const key of NOTEBOOK_REQUIRED) expect(notebook).toHaveProperty(key);
    expect(notebook.nbformat).toBe(4);
    expect(notebook.nbformat_minor).toBe(5);
  });

  it('gives every cell the fields its type requires', async () => {
    const notebook = JSON.parse((await outputs()).notebook);
    expect(notebook.cells.length).toBeGreaterThan(0);
    for (const cell of notebook.cells) {
      const required = cell.cell_type === 'code' ? CODE_CELL_REQUIRED : CELL_REQUIRED;
      for (const key of required) expect(cell, `${cell.id}.${key}`).toHaveProperty(key);
      expect(typeof cell.source).toBe('string');
    }
  });

  it('gives every cell an id the schema accepts', async () => {
    // 4.5 requires `id` on every cell, and we declare 4.5. A reader that finds
    // none invents one, differently on every read: two downloads of an unchanged
    // library would then differ cell for cell as soon as anyone opened and saved
    // them, which is the diff cell ids exist to make possible.
    const notebook = JSON.parse((await outputs()).notebook);
    const ids = notebook.cells.map((cell: { id: string }) => cell.id);
    for (const id of ids) {
      expect(id).toMatch(CELL_ID);
      expect(id.length).toBeGreaterThan(0);
      expect(id.length).toBeLessThanOrEqual(64);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps a query cell id across an export that adds another query', async () => {
    // The point of deriving the id from the bundle key rather than counting
    // cells: adding a query re-exports every other cell unchanged.
    const before = JSON.parse((await outputs()).notebook);
    const { buildExportBundle } = await import('../../../src/lib/export/queryBundle.js');
    const grown = await buildExportBundle({
      library: { id: 'urn:sqlib:library:derived-outputs', name: 'Derived Outputs Fixture' },
      queries: [
        { name: 'Added first', queryString: 'ASK { ?s ?p ?o }' },
        ...FIXTURE_QUERIES.map((query) => ({ ...query })),
      ],
      generatedAt: '2026-09-07T00:00:00.000Z',
    });
    const after = JSON.parse(generateNotebook(grown, { skipped: FIXTURE_SKIPPED }));

    const idsBefore: string[] = before.cells.map((cell: { id: string }) => cell.id);
    const idsAfter: string[] = after.cells.map((cell: { id: string }) => cell.id);
    for (const id of idsBefore) expect(idsAfter).toContain(id);
    expect(idsAfter).toContain('md-added-first');
  });

  it('truncates and de-duplicates an id the schema would reject', async () => {
    const long = 'A'.repeat(120);
    const bundle = await (await import('../../../src/lib/export/queryBundle.js')).buildExportBundle({
      library: { id: 'urn:sqlib:library:long' },
      queries: [
        { name: long, queryString: 'ASK { ?s ?p ?o }' },
        { name: `${long} again`, queryString: 'ASK { ?s ?p ?a }' },
      ],
      generatedAt: '2026-09-07T00:00:00.000Z',
    });
    const notebook = JSON.parse(generateNotebook(bundle));
    const ids = notebook.cells.map((cell: { id: string }) => cell.id);
    for (const id of ids) {
      expect(id).toMatch(CELL_ID);
      expect(id.length).toBeLessThanOrEqual(64);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the names that cross the package boundary are published ones', () => {
  it('imports only runtime types the package exports', async () => {
    // The declaration is compiled by the consumer against whatever version of
    // `@sparql-query-lib/runtime` they installed. A type it names that the
    // package does not export is an error in their build and in no build here.
    const { typings } = await outputs();
    const published = publishedNames('@sparql-query-lib/runtime');
    const imports = [...typings.matchAll(/import type \{([^}]+)\} from '@sparql-query-lib\/runtime'/g)];
    expect(imports.length).toBeGreaterThan(0);
    for (const statement of imports) {
      for (const name of statement[1].split(',').map((part) => part.trim()).filter(Boolean)) {
        expect(published, `${name} is not on the runtime's published surface`).toContain(name);
      }
    }
  });

  it('is bound to the JSON by its file name, and augments no module', async () => {
    // The declaration used to say `declare module './queries.json'`, which no
    // consumer configuration accepts: as an ambient declaration a relative name
    // is TS2436, and as an augmentation of a resolvable JSON module it is
    // TS2671. What binds the two files is the name tsc looks for beside the
    // JSON — nothing inside the file — so the name is generated here and the
    // header spells it out for whoever moves the file.
    const { typings } = await outputs();
    expect(bundleTypingsFileName(MODULE_SPECIFIER)).toBe('queries.d.json.ts');
    expect(typings).not.toMatch(/declare module/);
    expect(typings).toContain('`queries.d.json.ts`');
    expect(typings).toContain('"allowArbitraryExtensions": true');
  });

  it('declares the fields a JSON module exports, so the default import is the bundle', async () => {
    // `import bundle from './queries.json'` is typed by the module's namespace:
    // a JSON module has no real default export, so TypeScript synthesises one
    // from the module itself. A declaration that only said `export default`
    // would type that import as a namespace holding a `default` and nothing
    // else — which is why every top-level field of this bundle is declared.
    const { bundle, typings } = await outputs();
    for (const field of Object.keys(bundle)) {
      expect(typings, `${field} is a bundle field the declaration does not export`)
        .toContain(`export declare const ${field}: Bundle['${field}'];`);
    }
    expect(typings).toContain('export default bundle;');
  });

  it('calls only browser-build exports on the page', async () => {
    // The page runs against the runtime's `./browser` entry point, in someone
    // else's browser, months later. Every test in demoPage.test.ts injects a
    // stub runtime, so a rename in the runtime is invisible here otherwise.
    const { page } = await outputs();
    const published = publishedNames('@sparql-query-lib/runtime/browser');
    const used = new Set<string>();
    for (const match of page.matchAll(/\bSQLIB\.([A-Za-z_$][\w$]*)/g)) used.add(match[1]);
    for (const match of page.matchAll(/\bmodule\.exports\.([A-Za-z_$][\w$]*)/g)) used.add(match[1]);

    expect(used.size).toBeGreaterThan(0);
    for (const name of used) {
      expect(published, `the page calls SQLIB.${name}, which the browser build does not export`)
        .toContain(name);
    }
  });
});
