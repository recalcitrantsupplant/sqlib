/**
 * The library Activity feed: who created, changed, saved, moved and deleted
 * what in one library, newest first.
 *
 * Nothing new is stored for the feed. Each item is read from a record that
 * exists for its own reasons:
 *
 * - `created`: an entity's `dateCreated` and `createdBy`.
 * - `saved`: a version's `dateCreated` and `createdBy`.
 * - `edited`: an entity's `dateModified` and `modifiedBy`. Only the last edit
 *   is known, because the entity keeps one `dateModified`. A save of a version
 *   also moves the parent's `dateModified`, so an edit within
 *   `SAME_WRITE_MS` of a version of the same entity is that save, and is left
 *   out. An edit within `SAME_WRITE_MS` of the create is the create, and an
 *   edit of an environment within `SAME_WRITE_MS` of one of its pointer
 *   moves is that move.
 * - `moved`: a `PointerMove` of an environment in the library.
 * - `deleted`: a `Removal` (`lib/removals.ts`).
 *
 * Items made before authorship was recorded carry no actor.
 */
import type { EntityTypeName } from '../persistence/entityTypeNames.js';
import { REMOVAL_KINDS, libraryOf } from './removals.js';

export type ActivityKind = 'created' | 'edited' | 'saved' | 'moved' | 'deleted';

/** The filter a caller names: `edited` keeps both edits and saved versions. */
export type ActivityFilter = 'created' | 'edited' | 'moved' | 'deleted';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  at: string;
  actor: string | null;
  entity: string;
  entityType: string;
  entityName: string | null;
  versionNumber?: number | null;
  environment?: string | null;
  environmentName?: string | null;
  fromVersionNumber?: number | null;
  toVersionNumber?: number | null;
}

export const SAME_WRITE_MS = 2000;

/** The version type of each versioned kind a library lists. */
export const VERSION_TYPES: Partial<Record<EntityTypeName, EntityTypeName>> = {
  Query: 'QueryVersion',
  QueryGroup: 'QueryGroupVersion',
  RuleSet: 'RuleSetVersion',
  Rule: 'RuleVersion',
  DataBlock: 'DataBlockVersion',
  DataGraph: 'DataGraphVersion',
  TupleSet: 'TupleSetVersion',
  ArgumentSet: 'ArgumentSetVersion',
  Test: 'TestVersion',
  EtlJob: 'EtlJobVersion',
  Notebook: 'NotebookVersion',
  BenchmarkExperiment: 'BenchmarkExperimentVersion',
};

export type Entity = Record<string, unknown> & { $id: string; '@type'?: unknown };

export interface ActivitySource {
  get(id: string): Entity | null;
  list(type: EntityTypeName): Entity[];
  /** The entities of the library the caller may read. */
  readable<T extends Entity>(items: T[]): T[];
}

export interface ActivityQuery {
  library: string;
  kind?: ActivityFilter;
  actor?: string;
  /** A cursor from an earlier page: the items after it. */
  before?: string;
  limit: number;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const ms = (value: unknown): number => (typeof value === 'string' ? Date.parse(value) : Number.NaN);

function nameOf(entity: Entity | null): string | null {
  return str(entity?.name);
}

/** Every item of the library, unsorted. */
function collect(source: ActivitySource, library: string): ActivityItem[] {
  const get = (id: string) => source.get(id);
  const items: ActivityItem[] = [];
  const environments = new Map<string, Entity>();
  const moves = source.list('PointerMove');
  const moveTimes = new Map<string, number[]>();
  for (const move of moves) {
    const env = str(move.isPartOf);
    if (env) moveTimes.set(env, [...(moveTimes.get(env) ?? []), ms(move.dateCreated)]);
  }

  for (const type of REMOVAL_KINDS) {
    const inLibrary = source.list(type).filter((entity) => libraryOf(entity, get) === library);
    const readable = source.readable(inLibrary);
    const versionType = VERSION_TYPES[type];
    const versionsByParent = new Map<string, Entity[]>();
    if (versionType) {
      const parents = new Set(readable.map((entity) => entity.$id));
      for (const version of source.list(versionType)) {
        const parent = str(version.isPartOf);
        if (!parent || !parents.has(parent)) continue;
        versionsByParent.set(parent, [...(versionsByParent.get(parent) ?? []), version]);
      }
    }

    for (const entity of readable) {
      if (type === 'Environment') environments.set(entity.$id, entity);
      const base = { entity: entity.$id, entityType: type, entityName: nameOf(entity) };
      const created = str(entity.dateCreated);
      if (created) {
        items.push({ ...base, id: `${entity.$id}#created`, kind: 'created', at: created, actor: str(entity.createdBy) });
      }

      const versions = versionsByParent.get(entity.$id) ?? [];
      for (const version of versions) {
        const at = str(version.dateCreated);
        if (!at) continue;
        items.push({
          ...base,
          id: version.$id,
          kind: 'saved',
          at,
          actor: str(version.createdBy),
          versionNumber: num(version.version),
        });
      }

      const modified = str(entity.dateModified);
      const modifiedMs = ms(modified);
      if (!modified || Number.isNaN(modifiedMs)) continue;
      if (Math.abs(modifiedMs - ms(created)) < SAME_WRITE_MS) continue;
      const writes = [...versions.map((version) => ms(version.dateCreated)), ...(moveTimes.get(entity.$id) ?? [])];
      if (writes.some((at) => Math.abs(modifiedMs - at) < SAME_WRITE_MS)) continue;
      items.push({ ...base, id: `${entity.$id}#edited`, kind: 'edited', at: modified, actor: str(entity.modifiedBy) });
    }
  }

  for (const move of moves) {
    const environment = environments.get(str(move.isPartOf) ?? '');
    const at = str(move.dateCreated);
    if (!environment || !at) continue;
    const entityId = str(move.movedEntity) ?? '';
    const moved = get(entityId);
    items.push({
      id: move.$id,
      kind: 'moved',
      at,
      actor: str(move.createdBy),
      entity: entityId,
      entityType: str(moved?.['@type']) ?? '',
      entityName: nameOf(moved),
      environment: environment.$id,
      environmentName: nameOf(environment),
      fromVersionNumber: num(get(str(move.fromVersion) ?? '')?.version),
      toVersionNumber: num(get(str(move.toVersion) ?? '')?.version),
    });
  }

  for (const removal of source.list('Removal')) {
    const at = str(removal.dateCreated);
    if (removal.isPartOf !== library || !at) continue;
    items.push({
      id: removal.$id,
      kind: 'deleted',
      at,
      actor: str(removal.createdBy),
      entity: str(removal.removedEntity) ?? '',
      entityType: str(removal.removedType) ?? '',
      entityName: str(removal.name),
    });
  }

  return items;
}

/** The cursor of an item: its time, then its id, so items in the same millisecond keep one order. */
export function cursorOf(item: Pick<ActivityItem, 'at' | 'id'>): string {
  return `${item.at}|${item.id}`;
}

function newestFirst(a: ActivityItem, b: ActivityItem): number {
  return b.at.localeCompare(a.at) || b.id.localeCompare(a.id);
}

/** One page of the feed, and the cursor of the next page (null on the last). */
export function libraryActivity(
  source: ActivitySource,
  query: ActivityQuery,
): { items: ActivityItem[]; next: string | null } {
  const kinds: Record<ActivityFilter, ActivityKind[]> = {
    created: ['created'],
    edited: ['edited', 'saved'],
    moved: ['moved'],
    deleted: ['deleted'],
  };
  const keep = query.kind ? new Set(kinds[query.kind]) : null;
  const all = collect(source, query.library)
    .filter((item) => !keep || keep.has(item.kind))
    .filter((item) => !query.actor || item.actor === query.actor)
    .filter((item) => !query.before || cursorOf(item) < query.before)
    .sort(newestFirst);
  const items = all.slice(0, query.limit);
  const next = all.length > query.limit ? cursorOf(items[items.length - 1]) : null;
  return { items, next };
}
