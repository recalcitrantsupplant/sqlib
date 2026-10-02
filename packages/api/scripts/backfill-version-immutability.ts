#!/usr/bin/env ts-node
/**
 * Stamp `immutable: true` on stored versions that predate it.
 *
 * Versions are frozen by type now (`src/lib/immutability.ts`), so the guard no
 * longer reads this flag and nothing depends on running this. What it fixes is
 * what the flag *says*: a version written before creation started setting it
 * reports `immutable: false` (or nothing) to every client that reads it, while
 * the server refuses to change it. This makes the two agree.
 *
 * Only the flag is written, and only where it is not already true. It is safe
 * to run repeatedly, and a no-op once every version carries it.
 *
 * Usage:  pnpm tsx scripts/backfill-version-immutability.ts [--dry-run]
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/server/config.js';
import { oxigraphStoreManager } from '../src/lib/OxigraphStoreManager.js';
import { isImmutableType } from '../src/lib/immutability.js';
import { SCHEMA_BY_TYPE } from '../src/persistence/schemaRegistry.js';
import { describeSchema } from '../src/persistence/schemaIntrospection.js';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean';

/** Frozen-by-type schemas that store the flag at all, with the IRIs to write it under. */
function targets(): Array<{ type: string; classIri: string; predicate: string }> {
  return Object.entries(SCHEMA_BY_TYPE)
    // A benchmark version is frozen by its flag, so an unset one is a draft and
    // is left alone.
    .filter(([type]) => isImmutableType(type) && type !== 'BenchmarkExperimentVersion')
    .flatMap(([type, schema]) => {
      const info = describeSchema(schema as unknown as Record<string, unknown>);
      const field = info.fields.find((candidate) => candidate.name === 'immutable');
      return field ? [{ type, classIri: info.classIri, predicate: field.predicate }] : [];
    });
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
  });
  return { backendConfig, store: oxigraphStoreManager.getPersistentStore(backendConfig.storeId) };
}

async function backfill(dryRun: boolean) {
  const { backendConfig, store } = await openStore();
  if (!store) throw new Error('Could not open the library store.');

  let stamped = 0;
  for (const { type, classIri, predicate } of targets()) {
    const rows = store.query(`
      SELECT ?v WHERE {
        ?v <${RDF_TYPE}> <${classIri}> .
        FILTER NOT EXISTS { ?v <${predicate}> true }
      }
    `) as Array<Map<string, { value: string }>>;
    const ids = (Array.isArray(rows) ? rows : []).map((row) => String(row.get('v')?.value ?? '')).filter(Boolean);
    console.log(`  ${type}: ${ids.length} without the flag`);
    stamped += ids.length;
    if (dryRun || ids.length === 0) continue;

    store.update(`
      DELETE { ?v <${predicate}> ?old }
      INSERT { ?v <${predicate}> "true"^^<${XSD_BOOLEAN}> }
      WHERE {
        ?v <${RDF_TYPE}> <${classIri}> .
        FILTER NOT EXISTS { ?v <${predicate}> true }
        OPTIONAL { ?v <${predicate}> ?old }
      }
    `);
  }

  console.log(`  ${stamped} version(s) ${dryRun ? 'would be ' : ''}stamped`);
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
  console.log(`Backfilling version immutability${dryRun ? ' (dry run)' : ''}`);
  backfill(dryRun)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Backfill failed:', error);
      process.exit(1);
    });
}

export { backfill, targets };
