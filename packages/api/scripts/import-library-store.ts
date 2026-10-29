#!/usr/bin/env ts-node

import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from '../src/server/config.js';
import { oxigraphStoreManager } from '../src/lib/OxigraphStoreManager.js';
import * as oxigraph from 'oxigraph';
import {
  clearEntities,
  closeLibraryDatabase,
  countEntities,
  importSubjects,
  openLibraryDatabase,
  toBinding,
  type StoredTriple,
} from '../src/persistence/sqliteEntityStore.js';

type ImportArgs = {
  filePath?: string;
  format?: string;
  replace?: boolean;
};

function parseArgs(): ImportArgs {
  const args = process.argv.slice(2);
  const parsed: ImportArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--file':
      case '-f':
        parsed.filePath = args[i + 1];
        i++;
        break;
      case '--format':
        parsed.format = args[i + 1];
        i++;
        break;
      case '--replace':
        parsed.replace = true;
        break;
      default:
        if (!arg.startsWith('-') && !parsed.filePath) {
          parsed.filePath = arg;
        }
        break;
    }
  }

  return parsed;
}

async function ensureLibraryStore() {
  const backendConfig = config.internalBackend;
  if (backendConfig.type !== 'oxigraph-persistent') {
    throw new Error('Library persistence must be configured for oxigraph-persistent to import data.');
  }

  await oxigraphStoreManager.initialize(backendConfig.storageDir);
  const store = await oxigraphStoreManager.createPersistentStore(backendConfig.storeId, {
    storeType: 'persistent',
    loadMethod: backendConfig.loadMethod,
    sourceConfig: backendConfig.sourceConfig,
  });

  return { backendConfig, store };
}

function detectFormat(filePath: string, override?: string): string {
  if (override) return override;
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ttl': return 'turtle';
    case '.nt': return 'ntriples';
    case '.nq': return 'nquads';
    case '.jsonld': return 'jsonld';
    case '.rdf':
    case '.xml': return 'rdfxml';
    default: return 'nquads';
  }
}

async function importLibraryStore(args: ImportArgs) {
  if (!args.filePath) {
    throw new Error('Usage: pnpm import:library-store --file <path> [--format turtle|nquads|...] [--replace]');
  }
  const resolvedPath = path.resolve(args.filePath);
  await fs.access(resolvedPath);

  if (config.internalBackend.type === 'sqlite') {
    await importIntoSqlite(config.internalBackend.storageDir, resolvedPath, detectFormat(resolvedPath, args.format), args.replace === true);
    return;
  }

  const { backendConfig, store } = await ensureLibraryStore();
  const format = detectFormat(resolvedPath, args.format);

  if (args.replace) {
    store.update('DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }');
    console.log('Cleared existing triples before import.');
  }

  console.log(`Loading ${resolvedPath} into library store "${backendConfig.storeId}" using format ${format}`);
  await oxigraphStoreManager.loadDataFromFile(store, resolvedPath, format);
  console.log('✅ Import complete. Remember to restart the API to refresh the cache.');
}

/**
 * Loads an RDF file into the SQLite library store: one row per subject in the
 * default graph that has an `rdf:type`. This is how a library kept in
 * `oxigraph-persistent` (its `.nq` snapshot) or in Fuseki (a dump) moves over.
 */
async function importIntoSqlite(storageDir: string, filePath: string, format: string, replace: boolean) {
  const database = openLibraryDatabase(storageDir);
  try {
    const existing = countEntities(database);
    if (existing > 0 && !replace) {
      throw new Error(`The SQLite library store already holds ${existing} entities. Pass --replace to overwrite them.`);
    }

    const parsed = new oxigraph.Store();
    await oxigraphStoreManager.loadDataFromFile(parsed, filePath, format);

    const subjects = new Map<string, StoredTriple[]>();
    let skippedBlank = 0;
    for (const quad of parsed.match(null, null, null, oxigraph.defaultGraph())) {
      if (quad.subject.termType !== 'NamedNode') {
        skippedBlank += 1;
        continue;
      }
      const triples = subjects.get(quad.subject.value) ?? [];
      triples.push({ p: quad.predicate.value, o: toBinding(quad.object) });
      subjects.set(quad.subject.value, triples);
    }
    const namedGraphQuads = parsed.size - parsed.match(null, null, null, oxigraph.defaultGraph()).length;

    if (replace && existing > 0) {
      clearEntities(database);
      console.log(`Removed ${existing} existing entities before import.`);
    }
    const { imported, untyped } = importSubjects(database, subjects);

    console.log(`Imported ${imported} entities from ${filePath} into ${storageDir}.`);
    if (untyped.length > 0) {
      console.warn(`Skipped ${untyped.length} subjects with no rdf:type, for example ${untyped.slice(0, 5).join(', ')}.`);
    }
    if (skippedBlank > 0) console.warn(`Skipped ${skippedBlank} triples with a blank-node subject.`);
    if (namedGraphQuads > 0) {
      console.warn(`Skipped ${namedGraphQuads} quads in named graphs: the library is the default graph only.`);
    }
    console.log('✅ Import complete. Remember to restart the API to refresh the cache.');
  } finally {
    closeLibraryDatabase();
  }
}

const modulePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (modulePath === entryPath) {
  const parsed = parseArgs();
  importLibraryStore(parsed)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Failed to import library store:', error);
      process.exit(1);
    });
}

export { importLibraryStore };
