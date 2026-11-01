/**
 * The published tools, collected once when the server starts.
 *
 * A query or query group is published when its current version carries a
 * `tool` object, or when its library sets `publishAll` and the version does not
 * say `"tool": false`. Each tool pins the version that was current at startup,
 * and its default backend, so a tool never changes under an agent during a
 * session: a new version, a changed `tool` object or a new published query
 * takes effect at the next start. See `docs/guides/publishing-tools.md`.
 *
 * What is left to go wrong at startup is little, because the `tool` object was
 * checked when its version was saved: a publishing library with no slug, two
 * tools with one name, or a pinned backend that is gone. `MCP_CATALOGUE`
 * decides what that costs (`config/catalogueMode.ts`).
 */
import {
  checkToolObject,
  defaultToolObject,
  type DetectedInputs,
  type PublishedToolSpec,
  type ToolObject,
} from '@sparql-query-lib/tools';
import { EPHEMERAL_BACKEND_ID, LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { resolveQueryDefaultBackend } from './defaultBackend.js';
import { SparqlQueryParser } from './parser.js';
import { groupInputs } from './toolObject.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import type { LdkitLibrary } from '../persistence/schemas/LibrarySchema.js';
import type { LdkitQuery } from '../persistence/schemas/QuerySchema.js';
import type { LdkitQueryGroup } from '../persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { LdkitQueryGroupVersion } from '../persistence/schemas/QueryGroupVersionSchema.js';

export type PublishedLibrary = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
};

export type PublishedCatalogue = {
  specs: PublishedToolSpec[];
  /** The libraries that publish at least one tool, by slug. */
  libraries: Map<string, PublishedLibrary>;
  /** One line per tool that could not be published, naming it. */
  problems: string[];
};

const EMPTY: PublishedCatalogue = { specs: [], libraries: new Map(), problems: [] };

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

function libraryOf(entity: LdkitQuery | LdkitQueryGroup): string | null {
  const parents = Array.isArray(entity.isPartOf) ? entity.isPartOf : [entity.isPartOf];
  return parents.find((id): id is string => get<Entity>(id)?.['@type'] === 'Library') ?? null;
}

/** A query version's tables, in tuple and member order, and its page parameters. */
function queryVersionInputs(version: LdkitQueryVersion): DetectedInputs {
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

function groupVersionInputs(version: LdkitQueryGroupVersion): DetectedInputs {
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
function groupReadsOnly(version: LdkitQueryGroupVersion): boolean {
  return (version.executionNodes ?? []).every(id => {
    const node = get<{ '@type'?: string; queryId?: string | null }>(id);
    if (node?.['@type'] !== 'QueryNode') return false;
    const queryVersion = get<LdkitQueryVersion>(node.queryId);
    return Boolean(queryVersion) && queryVersion!.queryType !== QueryTypeIri.update;
  });
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

  const entries: Array<{ kind: 'query' | 'group'; entity: LdkitQuery | LdkitQueryGroup }> = [
    ...(cache.list('Query') as LdkitQuery[]).map(entity => ({ kind: 'query' as const, entity })),
    ...(cache.list('QueryGroup') as LdkitQueryGroup[]).map(entity => ({ kind: 'group' as const, entity })),
  ];
  // Stable across restarts, so which of two same-named tools wins does not
  // depend on the order the store returned them.
  entries.sort((a, b) => a.entity.$id.localeCompare(b.entity.$id));

  for (const { kind, entity } of entries) {
    const libraryId = libraryOf(entity);
    const library = get<LdkitLibrary>(libraryId);
    const version = get<LdkitQueryVersion | LdkitQueryGroupVersion>(entity.currentVersion);
    if (!library || !version) continue;

    const declared = version.tool;
    if (declared === false) continue;
    if (!declared && !library.publishAll) continue;

    const label = `${kind === 'query' ? 'Query' : 'Query group'} "${entity.name}" (${entity.$id})`;
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
      ? queryVersionInputs(version as LdkitQueryVersion)
      : groupVersionInputs(version as LdkitQueryGroupVersion);
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
      defaultBackendId = resolveQueryDefaultBackend(version, id => cache.get(id))?.backendId;
      if (defaultBackendId && !backendExists(defaultBackendId)) {
        problems.push(`${label}: its default backend ${defaultBackendId} does not exist.`);
        continue;
      }
    }

    specs.push({
      slug: library.slug,
      libraryId: library.$id,
      name: tool.name,
      description: tool.description,
      targetId: version.$id,
      targetKind: kind,
      readOnly: kind === 'query'
        ? (version as LdkitQueryVersion).queryType !== QueryTypeIri.update
        : groupReadsOnly(version as LdkitQueryGroupVersion),
      params: tool.params ?? {},
      inputs,
      ...(defaultBackendId ? { defaultBackendId } : {}),
      ...(kind === 'query' && tool.refusals ? { refusals: tool.refusals } : {}),
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

  return { specs, libraries, problems };
}
