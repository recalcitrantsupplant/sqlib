#!/usr/bin/env ts-node

import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from '../src/server/config.js';
import { oxigraphStoreManager } from '../src/lib/OxigraphStoreManager.js';

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
    persistPath: backendConfig.persistPath,
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
