/**
 * Reading and writing entities, keyed by *schema*.
 *
 * This is the engine underneath both entry points: `SelfHostedAdapter` (the
 * type-keyed `PersistenceAdapter` the cache talks to) and `createRepositoryLens`
 * (the per-entity repositories the writers and routes use). Both end up here, so
 * there is one implementation of how an entity becomes SPARQL and back.
 *
 * Keying on the schema rather than an entity-type name matters: the run records —
 * `TestRun`, `TestRunCase` and six benchmark types (`BenchmarkRun`,
 * `BenchmarkObservation`, `BenchmarkNodeRun`, `BenchmarkNodeObservation`,
 * `BenchmarkIterationRun`, `BenchmarkIterationObservation`) — have schemas and
 * repositories but are not in `SCHEMA_BY_TYPE`, because that registry mirrors the
 * *cache's* types and these are deliberately kept out of the cache (see
 * "Run records" in docs/explanation/storage-and-caching.md). They are persisted
 * all the same, and a registry lookup would have failed for them.
 *
 * Everything runs through the executor resolved by `LIBRARY_STORAGE_BACKEND_ID`,
 * which is what makes both internal backend modes work — oxigraph in-process and
 * HTTP with basic auth — without this file knowing which is configured.
 */
import { LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import type { SparqlSelectJsonOutput } from '../server/ISparqlExecutor.js';
import { ExecutorFactory } from '../lib/orchestration/ExecutorFactory.js';
import { assembleEntities, type BindingRow } from './EntityAssembler.js';
import { generateFindAllQuery, generateFindByIriQuery } from './readQueryGenerator.js';
import { generateDeleteQuery, generateInsertQuery, generateUpdateQuery } from './writeQueryGenerator.js';
import { describeSchema } from './schemaIntrospection.js';
import { iri, RDF_TYPE } from './sparqlTerms.js';

export type EntitySchema = Record<string, unknown>;

/**
 * Built on first use, not at module load: instantiating an `ExecutorFactory` at
 * import time would run before a test had a chance to mock it.
 *
 * The import is static, and it closes a cycle: `ExecutorFactory` resolves user
 * backends through the cache, and the cache persists through this module. That
 * is safe because nothing on the cycle reads an imported binding while its module
 * evaluates — `adapterRegistry` resolves the real adapter per call for exactly
 * this reason. Keep it that way: a top-level use of an import anywhere on the
 * cycle fails for whichever entry order reaches it first.
 */
let executorFactoryInstance: ExecutorFactory | null = null;

function executor() {
  executorFactoryInstance ??= new ExecutorFactory({ internal: true });
  return executorFactoryInstance.getExecutorForBackendId(LIBRARY_STORAGE_BACKEND_ID);
}

/**
 * Forget the factory, and with it the executor it cached against the library
 * store. For tests that reset the store underneath it.
 */
export function clearEntityStoreExecutor(): void {
  executorFactoryInstance = null;
}

async function runSelect(query: string): Promise<BindingRow[]> {
  const { result } = await (await executor()).selectQueryParsed(query);
  // An executor configured with a non-JSON Accept header would hand back raw
  // text; assembling from that would silently produce zero entities.
  if (typeof result === 'string') {
    throw new Error('Library storage executor returned unparsed SPARQL results; expected SPARQL JSON.');
  }
  return ((result as SparqlSelectJsonOutput)?.results?.bindings ?? []) as BindingRow[];
}

export async function findAllBySchema(schema: EntitySchema): Promise<Record<string, unknown>[]> {
  return assembleEntities(schema, await runSelect(generateFindAllQuery(schema)));
}

export async function findByIriBySchema(schema: EntitySchema, id: string): Promise<Record<string, unknown> | null> {
  const entities = assembleEntities(schema, await runSelect(generateFindByIriQuery(schema, id)));
  return entities[0] ?? null;
}

/**
 * The highest `version` stored for a version schema's children of `parentId`,
 * or 0 when there are none. For numbering when the cache was not preloaded and
 * so cannot see versions an earlier process wrote.
 */
export async function highestVersionInStore(schema: EntitySchema, parentId: string): Promise<number> {
  const info = describeSchema(schema);
  const field = (name: string) => {
    const found = info.fields.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`${info.classIri} declares no ${name}; it is not a version schema.`);
    return found.predicate;
  };
  const rows = await runSelect(
    `SELECT (MAX(?version) AS ?highest) WHERE {\n` +
      `  ?v ${iri(RDF_TYPE)} ${iri(info.classIri)} ;\n` +
      `     ${iri(field('isPartOf'))} ${iri(parentId)} ;\n` +
      `     ${iri(field('version'))} ?version .\n` +
      `}`,
  );
  const highest = rows[0]?.highest;
  const value = Number.parseInt(typeof highest === 'string' ? highest : String((highest as { value?: unknown })?.value ?? ''), 10);
  return Number.isNaN(value) ? 0 : value;
}

export async function insertBySchema(schema: EntitySchema, entity: Record<string, unknown>): Promise<void> {
  await (await executor()).update(generateInsertQuery(schema, entity));
}

export async function updateBySchema(schema: EntitySchema, id: string, patch: Record<string, unknown>): Promise<void> {
  const query = generateUpdateQuery(schema, id, patch);
  // A patch touching nothing the schema declares has no query to run.
  if (!query) return;
  await (await executor()).update(query);
}

/**
 * Boot load: every registered entity type, keyed by IRI.
 *
 * Types are read concurrently. A type that fails logs and yields nothing rather
 * than aborting the boot — losing one type is recoverable, a server that will not
 * start is not.
 *
 * The `@id`/`$id`/`@type` normalisation the cache expects is added here; the
 * per-entity reads do not emit it.
 */
export async function loadAllEntities(
  schemasByType: Record<string, EntitySchema>,
): Promise<Map<string, Record<string, unknown>>> {
  const started = Date.now();
  const types = Object.keys(schemasByType);
  const perType = await Promise.all(
    types.map(async (type) => {
      try {
        return { type, entities: await findAllBySchema(schemasByType[type]) };
      } catch (error) {
        console.error(`[Persistence] Error loading ${type} entities:`, error);
        return { type, entities: [] as Record<string, unknown>[] };
      }
    }),
  );

  const all = new Map<string, Record<string, unknown>>();
  for (const { type, entities } of perType) {
    for (const entity of entities) {
      const id = (entity as { $id?: string }).$id;
      if (!id) {
        console.warn('[Persistence] Found entity without $id, skipping:', entity);
        continue;
      }
      all.set(id, { ...entity, '@id': id, $id: id, '@type': type });
    }
  }

  console.log(`[Persistence] Loaded ${all.size} entities from ${types.length} types in ${Date.now() - started} ms.`);
  return all;
}

/** Deletes the entity's own triples. The schema is not needed — the IRI identifies it. */
export async function deleteByIri(id: string): Promise<void> {
  await (await executor()).update(generateDeleteQuery(id));
}
