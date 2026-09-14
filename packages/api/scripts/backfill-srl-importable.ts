#!/usr/bin/env ts-node
/**
 * Recompute the stored `srlImportable` flag on query versions.
 *
 * The flag says whether a version's query converts to a single SRL rule, and it
 * is decided once, when the version is written, because a version is immutable
 * and the import picker would otherwise convert every query in a library just
 * to draw its list.
 *
 * Immutability is also why this script has to exist. The verdict depends on the
 * import whitelist, and the whitelist moves: accepting `INSERT … WHERE`
 * alongside CONSTRUCT (revision 2) turned a class of stored `false`s into lies,
 * and nothing in the write path will ever revisit them. So each flag is stamped
 * with the `SRL_IMPORT_REVISION` that decided it, and this recomputes the ones
 * left behind.
 *
 * Only the flag is rewritten — never the query, never the version's content —
 * so this does not violate what immutability protects. It is safe to run
 * repeatedly, and a no-op once every version is current.
 *
 * Usage:  pnpm tsx scripts/backfill-srl-importable.ts [--dry-run] [--all]
 *
 *   --dry-run  report what would change, write nothing
 *   --all      recompute every version, not just the ones behind the current
 *              revision (use after changing the converter without bumping it)
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SRL_IMPORT_REVISION } from '@sparql-query-lib/srl';
import { config } from '../src/server/config.js';
import { oxigraphStoreManager } from '../src/lib/OxigraphStoreManager.js';
import { srlImportability } from '../src/lib/QueryVersionWriter.js';

const QUERY = 'https://sparql-query-lib/query';
const QUERY_TYPE = 'https://sparql-query-lib/queryType';
const IMPORTABLE = 'https://sparql-query-lib/srlImportable';
const REVISION = 'https://sparql-query-lib/srlImportRevision';
const XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';

interface VersionRow {
  id: string;
  queryString: string;
  queryType: string | undefined;
  importable: boolean | undefined;
  revision: number | undefined;
}

async function openStore() {
  const backendConfig = config.internalBackend;
  if (backendConfig.type !== 'oxigraph-persistent') {
    throw new Error('Library persistence must be oxigraph-persistent to backfill the store.');
  }
  await oxigraphStoreManager.initialize(backendConfig.storageDir);
  await oxigraphStoreManager.createPersistentStore(backendConfig.storeId, {
    storeType: 'persistent',
    loadMethod: backendConfig.loadMethod,
    sourceConfig: backendConfig.sourceConfig,
    persistPath: backendConfig.persistPath,
  });
  return { backendConfig, store: oxigraphStoreManager.getPersistentStore(backendConfig.storeId) };
}

/** Every version that carries a query string, with whatever verdict it holds. */
function readVersions(store: { query: (q: string) => unknown }): VersionRow[] {
  const rows = store.query(`
    SELECT ?v ?q ?type ?importable ?revision WHERE {
      ?v <${QUERY}> ?q .
      OPTIONAL { ?v <${QUERY_TYPE}> ?type }
      OPTIONAL { ?v <${IMPORTABLE}> ?importable }
      OPTIONAL { ?v <${REVISION}> ?revision }
    }
  `) as Array<Map<string, { value: string }>>;

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const importable = row.get('importable')?.value;
    const revision = row.get('revision')?.value;
    return {
      id: String(row.get('v')?.value ?? ''),
      queryString: String(row.get('q')?.value ?? ''),
      queryType: row.get('type')?.value,
      importable: importable === undefined ? undefined : importable === 'true',
      revision: revision === undefined ? undefined : Number(revision),
    };
  });
}

/*
 * Deliberately the write path's own function rather than a copy of it: a
 * backfill that decides differently from the writer would leave the store in a
 * state neither of them agrees with, and the difference would only surface as a
 * query that appears or disappears from the picker depending on which of the two
 * touched it last.
 */
const decide = (row: VersionRow): boolean =>
  srlImportability(row.queryString, row.queryType).srlImportable;

async function backfill(dryRun: boolean, all: boolean) {
  const { backendConfig, store } = await openStore();
  if (!store) throw new Error('Could not open the library store.');

  const versions = readVersions(store);
  // A version already at the current revision was decided by this very
  // whitelist, so recomputing it can only produce the answer it already holds.
  const stale = all ? versions : versions.filter((row) => row.revision !== SRL_IMPORT_REVISION);
  console.log(`  ${versions.length} version(s), ${stale.length} to recompute`);

  let flipped = 0;
  for (const row of stale) {
    const verdict = decide(row);
    if (verdict !== row.importable) {
      flipped += 1;
      console.log(`  ${row.id}: ${String(row.importable)} -> ${verdict}`);
    }
    if (dryRun) continue;

    store.update(`
      DELETE { <${row.id}> <${IMPORTABLE}> ?old }
      WHERE  { <${row.id}> <${IMPORTABLE}> ?old }
    `);
    store.update(`
      DELETE { <${row.id}> <${REVISION}> ?old }
      WHERE  { <${row.id}> <${REVISION}> ?old }
    `);
    store.update(`
      INSERT DATA {
        <${row.id}> <${IMPORTABLE}> "${verdict}"^^<${XSD_BOOLEAN}> ;
                    <${REVISION}> "${SRL_IMPORT_REVISION}"^^<${XSD_INTEGER}> .
      }
    `);
  }

  console.log(`  ${flipped} verdict(s) changed`);
  if (!dryRun) {
    await oxigraphStoreManager.serializePersistentStore(backendConfig.storeId);
    console.log('✅ Backfill complete and store persisted.');
  } else {
    console.log('✅ Dry run complete — nothing written.');
  }
}

const modulePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (modulePath === entryPath) {
  const dryRun = process.argv.includes('--dry-run');
  const all = process.argv.includes('--all');
  console.log(`Backfilling srlImportable to revision ${SRL_IMPORT_REVISION}${dryRun ? ' (dry run)' : ''}`);
  backfill(dryRun, all)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Backfill failed:', error);
      process.exit(1);
    });
}

export { backfill, decide };
