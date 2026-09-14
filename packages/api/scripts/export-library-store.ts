#!/usr/bin/env ts-node

import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from '../src/server/config.js';
import { oxigraphStoreManager } from '../src/lib/OxigraphStoreManager.js';

function parseArgs() {
  const args = process.argv.slice(2);
  let outPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--out' || arg === '-o') && args[i + 1]) {
      outPath = args[i + 1];
      i++;
    }
  }

  return { outPath };
}

async function ensureLibraryStore() {
  const backendConfig = config.internalBackend;
  if (backendConfig.type !== 'oxigraph-persistent') {
    throw new Error('Library persistence must be configured for oxigraph-persistent to export the store.');
  }

  await oxigraphStoreManager.initialize(backendConfig.storageDir);
  await oxigraphStoreManager.createPersistentStore(backendConfig.storeId, {
    storeType: 'persistent',
    loadMethod: backendConfig.loadMethod,
    sourceConfig: backendConfig.sourceConfig,
    persistPath: backendConfig.persistPath,
  });

  return backendConfig;
}

async function exportLibraryStore(outPath?: string) {
  const backendConfig = await ensureLibraryStore();
  console.log(`Exporting library store "${backendConfig.storeId}" from ${backendConfig.persistPath}`);

  await oxigraphStoreManager.serializePersistentStore(backendConfig.storeId);
  const defaultDumpName = `${backendConfig.storeId.replace(/[^a-zA-Z0-9]/g, '_')}.nq`;
  const defaultDumpPath = path.join(backendConfig.storageDir, defaultDumpName);

  let finalPath = defaultDumpPath;
  if (outPath) {
    const resolved = path.resolve(outPath);
    if (resolved !== defaultDumpPath) {
      await fs.copyFile(defaultDumpPath, resolved);
      finalPath = resolved;
    }
  }

  console.log(`✅ Library store exported to ${finalPath}`);
}

const modulePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (modulePath === entryPath) {
  const { outPath } = parseArgs();
  exportLibraryStore(outPath)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Failed to export library store:', error);
      process.exit(1);
    });
}

export { exportLibraryStore };
