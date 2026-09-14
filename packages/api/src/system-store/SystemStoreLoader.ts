import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as oxigraph from 'oxigraph';
import { QueryTypeIri } from '../constants/queryTypes.js';
import { SYSTEM_LIBRARY_ID, SystemQueryCatalog, type SystemQueryKey } from '../lib/system-queries/SystemQueryCatalog.js';
import type { LDKitEntity } from '../persistence/utils/entityRepository.js';

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url))); // packages/api
const DEFAULT_ASSET_DIR = path.join(PACKAGE_ROOT, 'system-store', 'assets');

// Common IRIs
const SDO = 'https://schema.org/';
const SQLIB = 'https://sparql-query-lib/';
const XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';

export interface SystemStoreLoadOptions {
  assetDir?: string;
}

export interface SystemStoreLoadResult {
  cacheEntries: Map<string, LDKitEntity>;
  store: oxigraph.Store;
  assetDir: string;
}

export function resolveAssetDir(override?: string): string {
  const envOverride = process.env.SYSTEM_STORE_ASSET_DIR;
  const target = override ?? envOverride ?? DEFAULT_ASSET_DIR;
  return path.isAbsolute(target) ? target : path.join(PACKAGE_ROOT, target);
}

export function getKnownSystemEntityIds(): Set<string> {
  const ids = [SYSTEM_LIBRARY_ID];
  for (const def of SystemQueryCatalog.listDefinitions()) {
    ids.push(def.queryId, def.versionId);
  }
  return new Set(ids);
}

export async function loadSystemStore(options: SystemStoreLoadOptions = {}): Promise<SystemStoreLoadResult> {
  const assetDir = resolveAssetDir(options.assetDir);
  const store = new oxigraph.Store();

  let files: string[];
  try {
    files = await fs.readdir(assetDir);
  } catch (error) {
    throw new Error(`Failed to read system store assets from ${assetDir}: ${(error as Error).message}`);
  }

  const assetFiles = files.filter(file => file.endsWith('.ttl') || file.endsWith('.n3'));
  if (assetFiles.length === 0) {
    throw new Error(`No system store asset files found in ${assetDir}`);
  }

  for (const file of assetFiles) {
    const fullPath = path.join(assetDir, file);
    const data = await fs.readFile(fullPath, 'utf8');
    try {
      store.load(data, { format: 'text/turtle' });
    } catch (error) {
      throw new Error(`Failed to parse system store asset ${file}: ${(error as Error).message}`);
    }
  }

  const cacheEntries = buildCacheEntries(store);
  return { cacheEntries, store, assetDir };
}

function buildCacheEntries(store: oxigraph.Store): Map<string, LDKitEntity> {
  const entries = new Map<string, LDKitEntity>();

  const library = buildLibrary(store);
  entries.set(library.$id, library);

  for (const def of SystemQueryCatalog.listDefinitions()) {
    const query = buildQuery(store, def.key);
    entries.set(query.$id, query);

    const version = buildQueryVersion(store, def.key);
    entries.set(version.$id, version);
  }

  return entries;
}

function buildLibrary(store: oxigraph.Store): LDKitEntity {
  const name = requireString(getStringObject(store, SYSTEM_LIBRARY_ID, `${SDO}name`), 'System library missing sdo:name');
  const description = getStringObject(store, SYSTEM_LIBRARY_ID, `${SDO}description`);
  const defaultBackend = getIriObject(store, SYSTEM_LIBRARY_ID, `${SQLIB}defaultBackend`);
  const dateCreated = getStringObject(store, SYSTEM_LIBRARY_ID, `${SDO}dateCreated`);
  const dateModified = getStringObject(store, SYSTEM_LIBRARY_ID, `${SDO}dateModified`);

  return {
    '@id': SYSTEM_LIBRARY_ID,
    $id: SYSTEM_LIBRARY_ID,
    '@type': 'Library',
    name,
    description: description ?? null,
    defaultBackend: defaultBackend ?? null,
    dateCreated: dateCreated ?? undefined,
    dateModified: dateModified ?? undefined,
  };
}

function buildQuery(store: oxigraph.Store, key: SystemQueryKey): LDKitEntity {
  const def = SystemQueryCatalog.getDefinition(key);
  const name = requireString(getStringObject(store, def.queryId, `${SDO}name`), `System query ${def.queryId} missing sdo:name`);
  const description = getStringObject(store, def.queryId, `${SDO}description`);
  const membership = getIriObjects(store, def.queryId, `${SDO}isPartOf`);
  if (!membership.includes(SYSTEM_LIBRARY_ID)) {
    throw new Error(`System query ${def.queryId} must be part of system library ${SYSTEM_LIBRARY_ID}`);
  }
  const currentVersion = getIriObject(store, def.queryId, `${SQLIB}currentVersion`);
  const defaultBackend = getIriObject(store, def.queryId, `${SQLIB}defaultBackend`);
  const dateCreated = getStringObject(store, def.queryId, `${SDO}dateCreated`);
  const dateModified = getStringObject(store, def.queryId, `${SDO}dateModified`);

  return {
    '@id': def.queryId,
    $id: def.queryId,
    '@type': 'Query',
    name,
    description: description ?? null,
    isPartOf: membership,
    currentVersion: currentVersion ?? def.versionId,
    defaultBackend: defaultBackend ?? null,
    dateCreated: dateCreated ?? undefined,
    dateModified: dateModified ?? undefined,
  };
}

function buildQueryVersion(store: oxigraph.Store, key: SystemQueryKey): LDKitEntity {
  const def = SystemQueryCatalog.getDefinition(key);
  const isPartOf = requireString(getIriObject(store, def.versionId, `${SDO}isPartOf`), `System query version ${def.versionId} missing parent query`);
  const version = requireNumber(getNumberObject(store, def.versionId, `${SDO}version`), `System query version ${def.versionId} missing sdo:version`);
  const queryString = requireString(getStringObject(store, def.versionId, `${SQLIB}query`), `System query version ${def.versionId} missing sqlib:query`);
  const queryType = getIriObject(store, def.versionId, `${SQLIB}queryType`) ?? QueryTypeIri.construct;
  const immutable = getBooleanObject(store, def.versionId, `${SQLIB}isImmutable`) ?? true;
  const comment = getStringObject(store, def.versionId, `${SDO}comment`);
  const limitParameters = getIriObjects(store, def.versionId, `${SQLIB}limitParameters`);
  const offsetParameters = getIriObjects(store, def.versionId, `${SQLIB}offsetParameters`);
  const dateCreated = getStringObject(store, def.versionId, `${SDO}dateCreated`);
  const dateModified = getStringObject(store, def.versionId, `${SDO}dateModified`);

  return {
    '@id': def.versionId,
    $id: def.versionId,
    '@type': 'QueryVersion',
    isPartOf,
    version,
    queryString,
    queryType,
    immutable,
    comment: comment ?? null,
    limitParameters: limitParameters.length > 0 ? limitParameters : undefined,
    offsetParameters: offsetParameters.length > 0 ? offsetParameters : undefined,
    dateCreated: dateCreated ?? undefined,
    dateModified: dateModified ?? undefined,
  };
}

function getStringObject(store: oxigraph.Store, subjectIri: string, predicateIri: string): string | null {
  const quad = getFirstObject(store, subjectIri, predicateIri);
  if (!quad) return null;
  if (quad.termType === 'Literal' || quad.termType === 'NamedNode') {
    return quad.value;
  }
  return null;
}

function getIriObject(store: oxigraph.Store, subjectIri: string, predicateIri: string): string | null {
  const quad = getFirstObject(store, subjectIri, predicateIri);
  if (quad?.termType === 'NamedNode') {
    return quad.value;
  }
  return null;
}

function getIriObjects(store: oxigraph.Store, subjectIri: string, predicateIri: string): string[] {
  const matches = store.match(oxigraph.namedNode(subjectIri), oxigraph.namedNode(predicateIri));
  const result: string[] = [];
  for (const quad of matches) {
    if (quad.object.termType === 'NamedNode') {
      result.push(quad.object.value);
    }
  }
  return result;
}

function getBooleanObject(store: oxigraph.Store, subjectIri: string, predicateIri: string): boolean | null {
  const quad = getFirstObject(store, subjectIri, predicateIri);
  if (!quad || quad.termType !== 'Literal') return null;
  if (quad.datatype?.value === XSD_BOOLEAN) {
    return quad.value === 'true' || quad.value === '1';
  }
  const normalized = quad.value.toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return null;
}

function getNumberObject(store: oxigraph.Store, subjectIri: string, predicateIri: string): number | null {
  const quad = getFirstObject(store, subjectIri, predicateIri);
  if (!quad || quad.termType !== 'Literal') return null;
  if (quad.datatype?.value && quad.datatype.value !== XSD_INTEGER) {
    return Number.isFinite(Number(quad.value)) ? Number(quad.value) : null;
  }
  const parsed = Number.parseInt(quad.value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getFirstObject(store: oxigraph.Store, subjectIri: string, predicateIri: string): oxigraph.Term | null {
  const matches = Array.from(store.match(oxigraph.namedNode(subjectIri), oxigraph.namedNode(predicateIri)));
  const first = matches[0] as oxigraph.Quad | undefined;
  return first?.object ?? null;
}

function requireString(value: string | null, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function requireNumber(value: number | null, message: string): number {
  if (value === null || Number.isNaN(value)) throw new Error(message);
  return value;
}
