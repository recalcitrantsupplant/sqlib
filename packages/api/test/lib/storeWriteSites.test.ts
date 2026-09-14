import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Who is allowed to mutate an in-process Oxigraph store, and therefore who has
 * to say so.
 *
 * The periodic checkpoint skips a durable store the process has not written
 * (#443). That skip is only as sound as the list of writers: a mutation that
 * reaches a store without calling `markStoreWritten` makes "unchanged" a lie,
 * and the symptom is not a failing test but a snapshot quietly missing a
 * write — visible only after a crash, on a store the loop decided was clean.
 *
 * So the writers are enumerated rather than trusted. Each entry below is a
 * source file that reaches the raw binding, with the number of mutating calls
 * it makes; the test fails in **both** directions, so a new call site is a red
 * test naming the file, and a removed one has to be taken off this list.
 *
 * Adding a site here is not the fix on its own — the call has to be followed by
 * `markStoreWritten(store)`, which is what the count beside it is for. The
 * restore path in `storeSnapshot.ts` is the deliberate exception and is listed
 * with the reason: a store loaded from its own snapshot *matches* that
 * snapshot, so declaring a write there would checkpoint a store that is already
 * on disk.
 */

/**
 * Every site in `src` that mutates a store through the raw binding.
 *
 * `calls` is how many such calls the file makes; `marks` is how many
 * `markStoreWritten` calls it must make to cover the ones that can reach a
 * store the manager checkpoints. `marks: 0` is a file whose stores it builds
 * itself and never hands over — nothing checkpoints those, so there is nothing
 * to declare. One `markStoreWritten` can cover several calls when they are one
 * operation, which is why the two numbers are separate rather than equal.
 */
const MUTATION_SITES: Record<string, { calls: number; marks: number; why: string }> = {
  // The SPARQL write path — every executor-driven update in the process.
  'src/server/OxigraphSparqlExecutor.ts': { calls: 1, marks: 1, why: 'store.update' },
  // `loadDataFromBytes` and `loadDataFromSparql` both declare.
  'src/lib/OxigraphStoreManager.ts': { calls: 2, marks: 2, why: 'two load paths' },
  // The restore path, which does not declare: a store loaded from its own
  // snapshot matches that snapshot, so there is nothing new to checkpoint.
  'src/lib/storeSnapshot.ts': { calls: 1, marks: 0, why: 'restore from snapshot' },
  // Hydration from data graphs, into a memory store the manager owns.
  'src/lib/dataGraphHydration.ts': { calls: 1, marks: 1, why: 'store.load' },
  // The quad-level apply branch, which reaches a resolved target's store
  // directly instead of going through its executor.
  'src/lib/patchService.ts': { calls: 3, marks: 1, why: 'apply by quad (one operation), and a local store for parsing' },
  // `DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }` on a memory or ephemeral store.
  'src/routes/backends.ts': { calls: 1, marks: 1, why: 'the clear route' },
  // The store arrives from a factory, so this cannot know whose it is.
  'src/persistence/OxigraphQueryEngine.ts': { calls: 1, marks: 1, why: 'queryVoid' },

  // Below here: stores built in the file, used, and dropped.
  'src/lib/RuleSetExecutor.ts': { calls: 3, marks: 0, why: 'the inference store, and a TupleStore that is not oxigraph' },
  'src/lib/dataGraphContent.ts': { calls: 2, marks: 0, why: 'parse validation' },
  'src/lib/deltaStore.ts': { calls: 1, marks: 0, why: 'a document read into a store' },
  'src/lib/patchLog.ts': { calls: 1, marks: 0, why: 'parsing a patch side that uses RDF 1.2 syntax' },
  'src/lib/rdfCanonicalizer.ts': { calls: 1, marks: 0, why: 'canonicalisation' },
  'src/lib/w3cRulesSuite/manifest.ts': { calls: 1, marks: 0, why: 'the suite manifest' },
  'src/system-store/SystemStoreLoader.ts': { calls: 1, marks: 0, why: 'the system store' },
  'src/auth/AuthStore.ts': { calls: 6, marks: 0, why: 'its own store and its own persistence' },
  // `AuthStore.load`, which is not an oxigraph store at all — it takes a seed
  // path. Listed because the scan reads receivers, not types.
  'src/auth/bootstrap.ts': { calls: 1, marks: 0, why: 'AuthStore.load' },
};

/** A mutating call on an oxigraph store, however the variable is named. */
const MUTATION_CALL = /\b[A-Za-z_$][\w$]*\.(?:load|update|add|delete)\s*\(/g;

/**
 * The receiver has to *be* a store: a name ending in `store`/`Store`.
 *
 * Deliberately not a substring test. The manager's own bookkeeping maps
 * (`pendingDurableStores`, `storeStats`) take `.delete` on the same line
 * shapes, and `patternsToRemove.add` in the parser contains the letters of
 * "store" by accident — an `.add` on a `Set` is what most of the noise is.
 */
const IS_STORE_RECEIVER = /(?:^|[a-z_$])[Ss]tore$/;

const srcDir = path.resolve(fileURLToPath(new URL('../../src', import.meta.url)));

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith('.ts')) {
      yield full;
    }
  }
}

describe('oxigraph store mutation sites', () => {
  it('are exactly the ones the checkpoint skip accounts for', async () => {
    const found: Record<string, number> = {};

    for await (const file of walk(srcDir)) {
      const source = await fs.readFile(file, 'utf8');
      const rel = path.relative(path.resolve(srcDir, '..'), file).split(path.sep).join('/');

      for (const match of source.matchAll(MUTATION_CALL)) {
        const receiver = match[0].slice(0, match[0].indexOf('.'));
        // Only calls whose receiver is a store — `store`, `this.store`,
        // `target.store`, `inferenceStore`. Everything else these method names
        // match is Map/Set bookkeeping.
        if (!IS_STORE_RECEIVER.test(receiver)) continue;
        found[rel] = (found[rel] ?? 0) + 1;
      }
    }

    // A scan that finds nothing has stopped measuring rather than passed:
    // every entry above is a call site that exists today.
    expect(Object.keys(found).length).toBeGreaterThan(0);

    const expected = Object.fromEntries(
      Object.entries(MUTATION_SITES).map(([file, site]) => [file, site.calls]),
    );
    expect(found).toEqual(expected);
  });

  it('declare their writes as many times as they are expected to', async () => {
    // The count above says how many mutating calls a file makes; this counts
    // the declarations beside them. Between the two, a write path added to one
    // of these files is a red test rather than a silent skip — and a
    // declaration deleted from one is red too, which is the direction that
    // costs data.
    for (const [file, site] of Object.entries(MUTATION_SITES)) {
      const source = await fs.readFile(path.resolve(srcDir, '..', file), 'utf8');
      const marks = source.match(/markStoreWritten\(/g)?.length ?? 0;
      expect(marks, `${file} (${site.why})`).toBe(site.marks);
    }
  });
});
