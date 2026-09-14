#!/usr/bin/env ts-node
/**
 * Migrate stored `grammarType` values to the single SRL dialect.
 *
 * The tri-grammar split retired with the vendored sparqljs fork:
 *   'shacl-rules'            -> 'srl'
 *   'rules-with-negation'    -> 'srl'   (negation is part of SRL)
 *   'rules-with-aggregation' -> reported, NOT rewritten (unsupported feature —
 *                               such a rule needs manual attention)
 *
 * `grammarType` is advisory (the validator always parses as SRL and re-derives
 * the field on every write), so this is tidy-up: it stops stale values showing
 * in the UI. Safe to run repeatedly.
 *
 * Usage:  pnpm tsx scripts/migrate-grammar-type-to-srl.ts [--dry-run]
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/server/config.js';
import { oxigraphStoreManager } from '../src/lib/OxigraphStoreManager.js';

const GRAMMAR_TYPE = 'https://sparql-query-lib/grammarType';
const REWRITE = ['shacl-rules', 'rules-with-negation'];
const UNSUPPORTED = 'rules-with-aggregation';

async function openStore() {
  const backendConfig = config.internalBackend;
  if (backendConfig.type !== 'oxigraph-persistent') {
    throw new Error('Library persistence must be oxigraph-persistent to migrate the store.');
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

async function migrate(dryRun: boolean) {
  const { backendConfig, store } = await openStore();
  if (!store) throw new Error('Could not open the library store.');

  const count = (value: string): number => {
    const rows = store.query(
      `SELECT (COUNT(*) AS ?n) WHERE { ?s <${GRAMMAR_TYPE}> ${JSON.stringify(value)} }`,
    ) as Array<Map<string, { value: string }>>;
    const first = Array.isArray(rows) ? rows[0] : undefined;
    return Number(first?.get('n')?.value ?? 0);
  };

  for (const stale of REWRITE) {
    const n = count(stale);
    if (n === 0) {
      console.log(`  ${stale}: none`);
      continue;
    }
    console.log(`  ${stale}: ${n} ${dryRun ? '(would rewrite)' : '-> rewriting to "srl"'}`);
    if (!dryRun) {
      store.update(`
        DELETE { ?s <${GRAMMAR_TYPE}> ${JSON.stringify(stale)} }
        INSERT { ?s <${GRAMMAR_TYPE}> "srl" }
        WHERE  { ?s <${GRAMMAR_TYPE}> ${JSON.stringify(stale)} }
      `);
    }
  }

  const aggregation = count(UNSUPPORTED);
  if (aggregation > 0) {
    console.warn(
      `⚠️  ${aggregation} row(s) still declare "${UNSUPPORTED}". Aggregation is not supported by the SRL engine; ` +
        'these rules need manual review (they were left untouched).',
    );
  } else {
    console.log(`  ${UNSUPPORTED}: none`);
  }

  if (!dryRun) {
    await oxigraphStoreManager.serializePersistentStore(backendConfig.storeId);
    console.log('✅ Migration complete and store persisted.');
  } else {
    console.log('✅ Dry run complete — nothing written.');
  }
}

const modulePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (modulePath === entryPath) {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Migrating grammarType -> 'srl'${dryRun ? ' (dry run)' : ''}`);
  migrate(dryRun)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

export { migrate };
