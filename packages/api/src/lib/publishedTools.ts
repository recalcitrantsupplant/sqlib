/**
 * The published tools, collected once when the server starts.
 *
 * A query, query group or rule set is published when its current version carries a
 * `tool` object, or when its library sets `publishAll` and the version does not
 * say `"tool": false`. Each tool pins the version that was current at startup,
 * and its default backend, so a tool never changes under an agent during a
 * session: a new version, a changed `tool` object or a new published query
 * takes effect at the next start. A rule set's data graph is pinned the same
 * way, at the version that was current at startup. See `docs/guides/publishing-tools.md`.
 *
 * What is left to go wrong at startup is little, because the `tool` object was
 * checked when its version was saved: a publishing library with no slug, two
 * tools with one name, or a pinned backend that is gone. `MCP_CATALOGUE`
 * decides what that costs (`config/catalogueMode.ts`).
 */
import { findEnvironment, requestedEnvironment, resolveVersionIn } from './environments.js';
import {
  checkOgcContext,
  checkOgcObject,
  checkToolObject,
  defaultToolObject,
  ogcParamKinds,
  type DetectedInputs,
  type OgcCollectionSpec,
  type OgcServiceCollection,
  type PublishedToolSpec,
  type ToolObject,
  type ToolTargetKind,
} from '@sparql-query-lib/tools';
import { EPHEMERAL_BACKEND_ID, LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { resolveQueryDefaultBackend } from './defaultBackend.js';
import { SparqlQueryParser } from './parser.js';
import { groupInputs } from './toolObject.js';
import { ruleTuplesAllowed } from './ruleTuples.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import type { PersistedLibrary } from '../persistence/schemas/LibrarySchema.js';
import type { PersistedQuery } from '../persistence/schemas/QuerySchema.js';
import type { PersistedQueryGroup } from '../persistence/schemas/QueryGroupSchema.js';
import type { PersistedQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { PersistedQueryGroupVersion } from '../persistence/schemas/QueryGroupVersionSchema.js';
import type { PersistedRuleSet } from '../persistence/schemas/RuleSetSchema.js';
import type { PersistedRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import type { PersistedOgcService } from '../persistence/schemas/OgcServiceSchema.js';
import type { PersistedOgcServiceVersion } from '../persistence/schemas/OgcServiceVersionSchema.js';

export type PublishedLibrary = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
};

export type PublishedCatalogue = {
  specs: PublishedToolSpec[];
  /**
   * The OGC API Features collections of the OGC services, at startup. The
   * OGC routes collect them again after a write (`server/ogcRoutes.ts`). See
   * `docs/proposals/ogc-services.md`.
   */
  collections: OgcCollectionSpec[];
  /** The libraries that publish at least one tool, by slug. */
  libraries: Map<string, PublishedLibrary>;
  /** One line per tool that could not be published, naming it. */
  problems: string[];
};

const EMPTY: PublishedCatalogue = { specs: [], collections: [], libraries: new Map(), problems: [] };

let current: PublishedCatalogue = EMPTY;

/** The catalogue the server published at startup. Empty until `loadPublishedCatalogue`. */
export function getPublishedCatalogue(): PublishedCatalogue {
  return current;
}

/** Collect and keep the catalogue. Called once, at startup, after the entity cache loads. */
export function loadPublishedCatalogue(): PublishedCatalogue {
  current = collectPublishedTools();
  return current;
}

/** Forget the catalogue, for tests that start more than one server. */
export function resetPublishedCatalogue(): void {
  current = EMPTY;
}

type Entity = { $id: string } & Record<string, unknown>;

const parser = new SparqlQueryParser();

function get<T>(id: unknown): T | null {
  return typeof id === 'string' && id ? (getCacheCoordinator().get(id) as T | null) : null;
}

type PublishedEntity = PersistedQuery | PersistedQueryGroup | PersistedRuleSet;
type PublishedVersion = PersistedQueryVersion | PersistedQueryGroupVersion | PersistedRuleSetVersion;

const KIND_LABEL: Record<ToolTargetKind, string> = { query: 'Query', group: 'Query group', ruleSet: 'Rule set' };

const NO_INPUTS: DetectedInputs = { tables: [], limits: [], offsets: [] };

function libraryOf(entity: PublishedEntity): string | null {
  const parents = Array.isArray(entity.isPartOf) ? entity.isPartOf : [entity.isPartOf];
  return parents.find((id): id is string => get<Entity>(id)?.['@type'] === 'Library') ?? null;
}

/** A query version's tables, in tuple and member order, and its page parameters. */
function queryVersionInputs(version: PersistedQueryVersion): DetectedInputs {
  const tables: string[][] = [];
  for (const tupleId of version.inferredInputs ?? []) {
    const tuple = get<{ memberEntries?: string[] | null }>(tupleId);
    const members = (tuple?.memberEntries ?? [])
      .map(id => get<{ position?: number | null; variable?: string | null }>(id))
      .filter((member): member is { position?: number | null; variable?: string | null } => Boolean(member))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const names = members
      .map(member => get<{ variableName?: string | null }>(member.variable)?.variableName)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    if (names.length) tables.push(names);
  }
  const pageNames = (ids: string[] | null | undefined) =>
    (ids ?? [])
      .map(id => get<{ name?: string | null }>(id)?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  return { tables, limits: pageNames(version.limitParameters), offsets: pageNames(version.offsetParameters) };
}

function groupVersionInputs(version: PersistedQueryGroupVersion): DetectedInputs {
  const startNode = get<{ outputs?: string[] | null }>(version.startNode);
  return groupInputs({
    startNodePorts: startNode?.outputs ?? [],
    nodeQueryVersionIds: (version.executionNodes ?? [])
      .map(id => get<{ queryId?: string | null }>(id)?.queryId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
    lookup: id => getCacheCoordinator().get(id),
    detect: queryString => parser.detectInputs(queryString),
  });
}

/**
 * Whether every node of a group only reads. A node whose query is chosen at
 * run time, or that applies a patch or runs rules, may write, so the group is
 * treated as one that does.
 */
function groupReadsOnly(version: PersistedQueryGroupVersion): boolean {
  return (version.executionNodes ?? []).every(id => {
    const node = get<{ '@type'?: string; queryId?: string | null }>(id);
    if (node?.['@type'] !== 'QueryNode') return false;
    const queryVersion = get<PersistedQueryVersion>(node.queryId);
    return Boolean(queryVersion) && queryVersion!.queryType !== QueryTypeIri.update;
  });
}

/** Whether a group's start node takes RDF: a `TriplesQuadsIO` output the run fills. */
function groupTakesData(version: PersistedQueryGroupVersion): boolean {
  const startNode = get<{ outputs?: string[] | null }>(version.startNode);
  return (startNode?.outputs ?? []).some(id => get<Entity>(id)?.['@type'] === 'TriplesQuadsIO');
}

function backendExists(id: string): boolean {
  if (id === EPHEMERAL_BACKEND_ID || id === LIBRARY_STORAGE_BACKEND_ID) return true;
  return get<Entity>(id)?.['@type'] === 'Backend';
}

/** Every published tool in the store, and a line for each that could not be. */
export function collectPublishedTools(): PublishedCatalogue {
  const cache = getCacheCoordinator();
  const specs: PublishedToolSpec[] = [];
  const problems: string[] = [];
  const libraries = new Map<string, PublishedLibrary>();
  const librariesWithoutSlug = new Set<string>();

  const entries: Array<{ kind: ToolTargetKind; entity: PublishedEntity }> = [
    ...(cache.list('Query') as PersistedQuery[]).map(entity => ({ kind: 'query' as const, entity })),
    ...(cache.list('QueryGroup') as PersistedQueryGroup[]).map(entity => ({ kind: 'group' as const, entity })),
    ...(cache.list('RuleSet') as PersistedRuleSet[]).map(entity => ({ kind: 'ruleSet' as const, entity })),
  ];
  // Stable across restarts, so which of two same-named tools wins does not
  // depend on the order the store returned them.
  entries.sort((a, b) => a.entity.$id.localeCompare(b.entity.$id));

  for (const { kind, entity } of entries) {
    const libraryId = libraryOf(entity);
    const library = get<PersistedLibrary>(libraryId);
    if (!library) continue;
    // A query that only a group uses is a part, not a tool.
    if (kind === 'query' && (entity as PersistedQuery).groupOnly === true) continue;
    // The version the deployment's environment points to
    // (`SQLIB_DEFAULT_ENVIRONMENT`), else the current one. An entry with no
    // version in that environment is not published: a prod server publishes
    // what was promoted to prod, and nothing else.
    const resolution = resolveVersionIn(entity as unknown as Parameters<typeof resolveVersionIn>[0], requestedEnvironment(undefined));
    if (!resolution.ok) continue;
    const version = get<PublishedVersion>(resolution.version);
    if (!version) continue;

    const declared = version.tool;
    if (declared === false) continue;
    if (!declared && !library.publishAll) continue;

    const label = `${KIND_LABEL[kind]} "${entity.name}" (${entity.$id})`;
    if (!library.slug) {
      if (!librariesWithoutSlug.has(library.$id)) {
        librariesWithoutSlug.add(library.$id);
        problems.push(`Library "${library.name}" (${library.$id}) publishes tools but has no slug; set one to publish ${label} and the rest.`);
      }
      continue;
    }

    const owner = libraries.get(library.slug);
    if (owner && owner.id !== library.$id) {
      problems.push(`${label}: library ${library.$id} has the slug "${library.slug}", which ${owner.id} already publishes under.`);
      continue;
    }

    const inputs = kind === 'query'
      ? queryVersionInputs(version as PersistedQueryVersion)
      : kind === 'group'
        ? groupVersionInputs(version as PersistedQueryGroupVersion)
        : NO_INPUTS;
    const tool: ToolObject = declared || defaultToolObject(entity, inputs);
    const problem = checkToolObject(tool, inputs, { targetKind: kind });
    if (problem) {
      problems.push(`${label}, version ${version.version}: ${problem}`);
      continue;
    }

    const clash = specs.find(spec => spec.slug === library.slug && spec.name === tool.name);
    if (clash) {
      problems.push(`${label}: library "${library.slug}" already publishes a tool named "${tool.name}" (${clash.targetId}).`);
      continue;
    }

    let defaultBackendId: string | undefined;
    if (kind === 'query') {
      defaultBackendId = resolveQueryDefaultBackend(version, id => cache.get(id), {
      environment: requestedEnvironment(undefined),
      findEnvironment,
    })?.backendId;
      if (defaultBackendId && !backendExists(defaultBackendId)) {
        problems.push(`${label}: its default backend ${defaultBackendId} does not exist.`);
        continue;
      }
    }

    let ruleSet: PublishedToolSpec['ruleSet'];
    if (kind === 'ruleSet') {
      let dataGraphVersionId: string | undefined;
      if (tool.dataGraphId) {
        const graph = get<{ '@type'?: string; currentVersion?: string | null }>(tool.dataGraphId);
        dataGraphVersionId = graph?.['@type'] === 'DataGraph' && graph.currentVersion ? graph.currentVersion : undefined;
        if (!dataGraphVersionId || !get<Entity>(dataGraphVersionId)) {
          problems.push(`${label}: its data graph ${tool.dataGraphId} does not exist or has no current version.`);
          continue;
        }
      }
      const tuplesEnabled = (version as PersistedRuleSetVersion).tuplesEnabled === true && ruleTuplesAllowed();
      ruleSet = {
        id: entity.$id,
        version: version.version,
        ...(dataGraphVersionId ? { dataGraphVersionId } : {}),
        ...(tuplesEnabled ? { tuplesEnabled } : {}),
      };
    }

    const readOnly = kind === 'query'
      ? (version as PersistedQueryVersion).queryType !== QueryTypeIri.update
      : kind === 'group'
        ? groupReadsOnly(version as PersistedQueryGroupVersion)
        : true;
    // A query can run over RDF the caller sends instead of a backend. An
    // update over it answers with the graph it leaves, so a caller with no
    // backend of its own keeps that graph and sends it with the next call.
    const acceptsData = kind === 'query'
      || (kind === 'group' && groupTakesData(version as PersistedQueryGroupVersion));

    specs.push({
      slug: library.slug,
      libraryId: library.$id,
      name: tool.name,
      description: tool.description,
      targetId: version.$id,
      targetKind: kind,
      // A rule set's inferences are its answer: nothing is written back.
      readOnly,
      ...(acceptsData ? { acceptsData } : {}),
      params: tool.params ?? {},
      inputs,
      ...(defaultBackendId ? { defaultBackendId } : {}),
      ...(kind === 'query' && tool.refusals ? { refusals: tool.refusals } : {}),
      ...(ruleSet ? { ruleSet } : {}),
    });
    if (!libraries.has(library.slug)) {
      libraries.set(library.slug, {
        id: library.$id,
        slug: library.slug,
        name: library.name,
        description: library.description,
      });
    }
  }

  const collections = collectOgcCollections(problems);
  return { specs, collections, libraries, problems };
}

/**
 * Every OGC collection in the store, from the OGC services
 * (`docs/proposals/ogc-services.md`). Each service's version in the
 * deployment's environment lists its collections, and each collection runs a
 * query of the service's library: a pinned version, or the query's version in
 * the environment. A collection that no longer fits its query, a slug two
 * services share, or two collections with one id in a service, is a problem
 * line, and that collection or service is left out.
 */
export function collectOgcCollections(problems: string[]): OgcCollectionSpec[] {
  const cache = getCacheCoordinator();
  const collections: OgcCollectionSpec[] = [];
  const services = (cache.list('OgcService') as PersistedOgcService[]).slice().sort((a, b) => a.$id.localeCompare(b.$id));
  const slugs = new Map<string, string>();
  for (const service of services) {
    const label = `OGC service "${service.name}" (${service.$id})`;
    const libraryId = libraryOf(service as never);
    if (!libraryId) continue;
    const holder = slugs.get(service.slug);
    if (holder) {
      problems.push(`${label}: the slug "${service.slug}" is already used by ${holder}.`);
      continue;
    }
    slugs.set(service.slug, service.$id);
    const resolution = resolveVersionIn(service as unknown as Parameters<typeof resolveVersionIn>[0], requestedEnvironment(undefined));
    if (!resolution.ok) continue;
    const version = get<PersistedOgcServiceVersion>(resolution.version);
    if (!version) continue;
    const seen = new Set<string>();
    for (const entry of version.collections ?? []) {
      const where = `${label}, version ${version.version}, collection "${entry.collectionId}"`;
      if (seen.has(entry.collectionId)) {
        problems.push(`${where}: the service already has a collection with this id.`);
        continue;
      }
      const spec = resolveOgcCollection({ service, libraryId, entry });
      if (typeof spec === 'string') {
        problems.push(`${where}: ${spec}`);
        continue;
      }
      seen.add(entry.collectionId);
      collections.push(spec);
    }
  }
  return collections;
}

/** The problems of each OGC service, by service id, from a fresh collection. */
export function ogcServiceProblems(): Map<string, string[]> {
  const problems: string[] = [];
  collectOgcCollections(problems);
  const byService = new Map<string, string[]>();
  for (const line of problems) {
    const id = /\((urn:[^)]+)\)/.exec(line)?.[1];
    if (!id) continue;
    byService.set(id, [...(byService.get(id) ?? []), line.replace(/^OGC service "[^"]*" \([^)]*\)(, )?/, '')]);
  }
  return byService;
}

/**
 * One collection of a service, resolved to what the routes run: its query
 * version, checked against the `ogc` object and the JSON-LD terms, with its
 * default backend and its values and index-field queries. A string is the
 * reason it cannot be served. Used when a service version is saved, and at
 * every rebuild of the OGC routes.
 */
export function resolveOgcCollection(options: {
  service: { $id: string; slug: string; name: string; description?: string | null };
  libraryId: string;
  entry: OgcServiceCollection;
}): OgcCollectionSpec | string {
  const { service, libraryId, entry } = options;
  const cache = getCacheCoordinator();
  const { query: queryId, queryVersion: pinnedId, context, ...ogc } = entry;
  const query = get<PersistedQuery>(queryId);
  if (!query || query['@type'] !== 'Query' || libraryOf(query) !== libraryId) {
    return `query: ${queryId} is not a query in the service's library.`;
  }
  let version: PersistedQueryVersion | null;
  if (pinnedId) {
    version = get<PersistedQueryVersion>(pinnedId);
    if (!version || version['@type'] !== 'QueryVersion' || version.isPartOf !== query.$id) {
      return `queryVersion: ${pinnedId} is not a version of query "${query.name}".`;
    }
  } else {
    const resolution = resolveVersionIn(query as unknown as Parameters<typeof resolveVersionIn>[0], requestedEnvironment(undefined));
    if (!resolution.ok) return `query "${query.name}" has no version in this environment.`;
    version = get<PersistedQueryVersion>(resolution.version);
    if (!version) return `query "${query.name}" has no version in this environment.`;
  }

  const inputs = queryVersionInputs(version);
  let outputs: string[] = [];
  try {
    outputs = parser.detectQueryOutputs(version.queryString) ?? [];
  } catch {
    // checkOgcObject reports the missing outputs.
  }
  const problem = checkOgcObject(ogc, { inputs, outputs, isSelect: version.queryType === QueryTypeIri.select });
  if (problem) return `${problem} (query "${query.name}", version ${version.version}).`;
  const omitted = new Set([ogc.feature.var, ...(typeof ogc.geometry === 'string' ? [ogc.geometry] : []), ...(ogc.omit ?? [])]);
  const contextProblem = checkOgcContext(context, outputs.filter(name => !omitted.has(name)));
  if (contextProblem) return `${contextProblem}.`;
  const closed = closedSlots(version);
  if (closed.length) {
    return `an OGC collection runs with its slots open, but ${closed.map(name => `?${name}`).join(', ')} ` +
      'must not run open (whenEmpty "require" or "propagateEmpty").';
  }
  const defaultBackendId = resolveQueryDefaultBackend(version, id => cache.get(id), {
    environment: requestedEnvironment(undefined),
    findEnvironment,
  })?.backendId;
  if (!defaultBackendId || !backendExists(defaultBackendId)) return 'the query needs a default backend that exists.';

  const versionOfQuery = (id: string, key: string): string => {
    const other = get<PersistedQuery>(id);
    const resolution = other?.['@type'] === 'Query'
      ? resolveVersionIn(other as unknown as Parameters<typeof resolveVersionIn>[0], requestedEnvironment(undefined))
      : null;
    if (!resolution?.ok || libraryOf(other!) !== libraryId) throw new Error(`${key}: ${id} is not a query with a version in the service's library.`);
    return resolution.version;
  };
  let configTargetId: string | undefined;
  let valuesTargetId: string | undefined;
  try {
    if (ogc.mode === 'cql2' && ogc.cql?.configQuery) configTargetId = versionOfQuery(ogc.cql.configQuery, 'cql.configQuery');
    if (ogc.valuesQuery) valuesTargetId = versionOfQuery(ogc.valuesQuery, 'valuesQuery');
  } catch (error) {
    return (error as Error).message;
  }
  return {
    slug: service.slug,
    libraryId,
    serviceId: service.$id,
    serviceTitle: service.name,
    serviceDescription: service.description,
    ogc,
    ...(context && Object.keys(context).length ? { context } : {}),
    ...(configTargetId ? { configTargetId } : {}),
    ...(valuesTargetId ? { valuesTargetId } : {}),
    tool: {
      slug: service.slug,
      libraryId,
      name: `ogc-${ogc.collectionId}`,
      description: ogc.title,
      targetId: version.$id,
      targetKind: 'query',
      readOnly: true,
      params: ogcParamKinds(ogc),
      inputs,
      defaultBackendId,
    },
  };
}

/** The variables of a query version's slots that may not run open. */
function closedSlots(version: PersistedQueryVersion): string[] {
  const names: string[] = [];
  for (const tupleId of version.inferredInputs ?? []) {
    const tuple = get<{ whenEmpty?: string | null; memberEntries?: string[] | null }>(tupleId);
    if (tuple?.whenEmpty !== 'require' && tuple?.whenEmpty !== 'propagateEmpty') continue;
    for (const memberId of tuple.memberEntries ?? []) {
      const member = get<{ variable?: string | null }>(memberId);
      const name = get<{ variableName?: string | null }>(member?.variable)?.variableName;
      if (name) names.push(name);
    }
  }
  return names;
}
