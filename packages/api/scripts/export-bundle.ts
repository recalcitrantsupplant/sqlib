#!/usr/bin/env tsx
/**
 * `sqlib export` — write a library's queries and groups out as a static bundle.
 *
 *   pnpm --filter @sparql-query-lib/api export:bundle \
 *     --library urn:sqlib:library:main --out queries.json [--tag <iri>[,<iri>]] \
 *     [--match any|all] [--typings] [--examples all|first|none] [--expected] \
 *     [--html [file]]
 *
 * The output is JSON that `@sparql-query-lib/runtime` runs with no SPARQL parser
 * and no sqlib server. Compilation still happens here, with the real parser, and
 * every template is verified against the AST path before it is written.
 *
 * `--examples` draws runnable examples from the library's own tests; `--expected`
 * carries their recorded results along as reference material; `--html` writes a
 * self-contained page that runs the whole library in a browser
 * (`docs/guides/static-export.md`).
 *
 * This reads the library store directly, so it runs against a stopped server.
 */

import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifyBundleIntegrity } from '@sparql-query-lib/runtime';
import { config } from '../src/server/config.js';
import { oxigraphStoreManager } from '../src/lib/OxigraphStoreManager.js';
import { memoryCacheManager } from '../src/lib/MemoryCacheManager.js';
import { getCacheCoordinator, getEntityRepositories } from '../src/lib/CacheCoordinatorProvider.js';
import { collectLibraryQueries } from '../src/lib/export/collectLibraryQueries.js';
import {
  collectLibraryGroups,
  type GroupGraphEntity,
} from '../src/lib/export/collectLibraryGroups.js';
import { attachGroupsToBundle } from '../src/lib/export/groupBundle.js';
import { buildExportBundle } from '../src/lib/export/queryBundle.js';
import { bundleTypingsFileName, generateBundleTypings } from '../src/lib/export/typings.js';
import {
  attachExamplesToBundle,
  type ExampleMode,
} from '../src/lib/export/collectQueryExamples.js';
import { generateDemoPage } from '../src/lib/export/demoPage.js';
import { ArgumentSetService } from '../src/lib/ArgumentSetService.js';
import type { LdkitTest } from '../src/persistence/schemas/TestSchema.js';
import type { LdkitTestVersion } from '../src/persistence/schemas/TestVersionSchema.js';
import type { LdkitTestCase } from '../src/persistence/schemas/TestCaseSchema.js';
import type { LdkitLibrary } from '../src/persistence/schemas/LibrarySchema.js';
import type { LdkitQuery } from '../src/persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../src/persistence/schemas/QueryVersionSchema.js';
import type { LdkitQueryGroup } from '../src/persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryGroupVersion } from '../src/persistence/schemas/QueryGroupVersionSchema.js';

interface Args {
  library?: string;
  out: string;
  tags: string[];
  match: 'any' | 'all';
  typings: boolean;
  examples: ExampleMode;
  expected: boolean;
  /** Path for the demo page, or undefined when one was not asked for. */
  html?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    out: 'queries.json',
    tags: [],
    match: 'any',
    typings: false,
    examples: 'all',
    expected: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value.`);
      i++;
      return value;
    };

    switch (arg) {
      case '--library':
      case '-l':
        args.library = next();
        break;
      case '--out':
      case '-o':
        args.out = next();
        break;
      case '--tag':
        args.tags.push(...next().split(',').map((t) => t.trim()).filter(Boolean));
        break;
      case '--match': {
        const value = next();
        if (value !== 'any' && value !== 'all') throw new Error("--match takes 'any' or 'all'.");
        args.match = value;
        break;
      }
      case '--typings':
        args.typings = true;
        break;
      case '--examples': {
        const value = next();
        if (value !== 'all' && value !== 'first' && value !== 'none') {
          throw new Error("--examples takes 'all', 'first' or 'none'.");
        }
        args.examples = value;
        break;
      }
      case '--expected':
        args.expected = true;
        break;
      case '--html':
        // The path is optional: `--html` alone writes alongside --out.
        args.html = argv[i + 1] && !argv[i + 1].startsWith('-') ? next() : '';
        break;
      default:
        throw new Error(`Unrecognised argument '${arg}'.`);
    }
  }

  if (!args.library) throw new Error('--library <iri> is required.');
  return args;
}

/** Bring up the library store and the entity cache, as the server does on boot. */
async function openLibrary(): Promise<void> {
  const backendConfig = config.internalBackend;
  if (backendConfig.type !== 'oxigraph-persistent') {
    throw new Error(
      `Library persistence is configured as '${backendConfig.type}'; this script reads an oxigraph-persistent store.`,
    );
  }
  await oxigraphStoreManager.initialize(backendConfig.storageDir);
  await oxigraphStoreManager.createPersistentStore(backendConfig.storeId, {
    storeType: 'persistent',
    loadMethod: backendConfig.loadMethod,
    sourceConfig: backendConfig.sourceConfig,
    persistPath: backendConfig.persistPath,
  });
  // Stores before the cache — the ordering src/index.ts uses on boot.
  await memoryCacheManager.loadAll();
}

export async function exportBundle(args: Args): Promise<void> {
  await openLibrary();
  const repos = getEntityRepositories();

  const library = repos.Library.get(args.library!) as LdkitLibrary | null;
  if (!library) throw new Error(`Library ${args.library} was not found.`);

  const { queries, skipped } = collectLibraryQueries(
    {
      listQueries: () => repos.Query.list() as LdkitQuery[],
      getQueryVersion: (id) => repos.QueryVersion.get(id) as LdkitQueryVersion | null,
    },
    args.library!,
    { tags: args.tags, match: args.match },
  );

  const bundle = await buildExportBundle({
    library: { id: args.library!, name: library.name },
    queries,
    tags: args.tags,
  });

  // The library's tests become runnable examples. A test that cannot be turned
  // into one is reported next to the queries that could not be exported.
  const argumentSetService = new ArgumentSetService();
  const { skipped: skippedExamples } = await attachExamplesToBundle(
    bundle,
    {
      listTests: () => repos.Test.list() as LdkitTest[],
      getTestVersion: (id) => repos.TestVersion.get(id) as LdkitTestVersion | null,
      getTestCase: (id) => repos.TestCase.get(id) as LdkitTestCase | null,
      resolveArgumentPayload: (id) =>
        argumentSetService.exportRuntimePayload([id]).then((payload) => ({
          arguments: payload.tupleList,
          limits: payload.limits,
          offsets: payload.offsets,
        })),
    },
    args.library!,
    { mode: args.examples, includeExpected: args.expected },
  );

  // The library's query groups, as walks over the queries above. A group that
  // needs a store the static runtime does not have is reported, not fatal.
  const { groups, skipped: skippedGroupReads } = collectLibraryGroups(
    {
      listGroups: () => repos.QueryGroup.list() as LdkitQueryGroup[],
      getGroupVersion: (id) => repos.QueryGroupVersion.get(id) as LdkitQueryGroupVersion | null,
      getEntity: (id) => getCacheCoordinator().get(id) as GroupGraphEntity | null,
    },
    args.library!,
    { tags: args.tags, match: args.match },
  );
  const { skipped: skippedGroups } = await attachGroupsToBundle(bundle, groups);

  // Re-hash what we are about to write. The check costs nothing here and it is
  // the same one a consumer runs, so a bundle that fails it never leaves.
  await verifyBundleIntegrity(bundle);

  const allSkipped = [...skipped, ...skippedExamples, ...skippedGroupReads, ...skippedGroups];

  const outPath = path.resolve(args.out);
  await fs.writeFile(outPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  const groupCount = Object.keys(bundle.groups ?? {}).length;
  console.log(
    `✅ Exported ${Object.keys(bundle.queries).length} queries${groupCount > 0 ? ` and ${groupCount} group(s)` : ''} to ${outPath}`,
  );

  if (args.typings) {
    const specifier = `./${path.basename(outPath)}`;
    // The name is the binding: tsc types `./queries.json` through a sibling
    // `queries.d.json.ts` and through nothing else, so the file cannot be
    // renamed and cannot move away from the JSON.
    const typingsPath = path.join(path.dirname(outPath), bundleTypingsFileName(specifier));
    await fs.writeFile(typingsPath, generateBundleTypings(bundle, specifier), 'utf8');
    console.log(`✅ Wrote typings for '${specifier}' to ${typingsPath}`);
    console.log('   Consuming tsconfig needs "allowArbitraryExtensions": true.');
  }

  if (args.html !== undefined) {
    const htmlPath = args.html
      ? path.resolve(args.html)
      : outPath.replace(/\.json$/, '') + '.html';
    await fs.writeFile(
      htmlPath,
      generateDemoPage(bundle, { skipped: allSkipped }),
      'utf8',
    );
    const exampleCount = Object.values(bundle.queries).reduce(
      (total, query) => total + (query.examples?.length ?? 0),
      0,
    );
    console.log(`✅ Wrote a runnable demo page with ${exampleCount} example(s) to ${htmlPath}`);
  }

  for (const entry of allSkipped) {
    console.warn(`⚠️  Skipped '${entry.name}': ${entry.reason}`);
  }
}

const modulePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (modulePath === entryPath) {
  Promise.resolve()
    .then(() => exportBundle(parseArgs(process.argv.slice(2))))
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
