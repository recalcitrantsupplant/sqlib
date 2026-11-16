/**
 * Sort orders for the section sidebars (`EntityListSidebar`, `BackendListSidebar`).
 *
 * Every saved entity carries `dateCreated`, `dateModified` and `createdBy` from
 * the server. "Last opened" comes from this browser (`useEntityLastOpened`).
 * A row with no value for the key sorts after the rows that have one, in either
 * direction, and rows with equal values fall back to the name.
 */

export type EntityListSortKey = 'name' | 'modified' | 'created' | 'opened' | 'creator' | 'versions';
export type SortDirection = 'asc' | 'desc';

export interface EntityListSort {
  key: EntityListSortKey;
  dir: SortDirection;
}

export const DEFAULT_SORT: EntityListSort = Object.freeze({ key: 'name', dir: 'asc' }) as EntityListSort;

/** The fields a row needs to be sorted. Every entity the sidebars list has them. */
export interface SortableEntity {
  id: string;
  name: string;
  dateCreated?: string | null;
  dateModified?: string | null;
  createdBy?: string | null;
  currentVersionNumber?: number | null;
}

export interface SortKeyOption {
  key: EntityListSortKey;
  /** Menu label. */
  label: string;
  /** Button label, when this key is on. */
  short: string;
  /** The direction a key starts in when it is picked. */
  defaultDir: SortDirection;
  /** Menu labels for asc and desc. */
  dirLabels: { asc: string; desc: string };
}

export const SORT_KEYS: SortKeyOption[] = [
  { key: 'name', label: 'Name', short: 'Name', defaultDir: 'asc', dirLabels: { asc: 'A to Z', desc: 'Z to A' } },
  { key: 'modified', label: 'Last modified', short: 'Modified', defaultDir: 'desc', dirLabels: { asc: 'Oldest first', desc: 'Newest first' } },
  { key: 'created', label: 'Created', short: 'Created', defaultDir: 'desc', dirLabels: { asc: 'Oldest first', desc: 'Newest first' } },
  { key: 'opened', label: 'Last opened', short: 'Opened', defaultDir: 'desc', dirLabels: { asc: 'Oldest first', desc: 'Newest first' } },
  { key: 'creator', label: 'Created by', short: 'Creator', defaultDir: 'asc', dirLabels: { asc: 'A to Z', desc: 'Z to A' } },
  { key: 'versions', label: 'Version count', short: 'Versions', defaultDir: 'desc', dirLabels: { asc: 'Fewest first', desc: 'Most first' } },
];

export function sortKeyOption(key: EntityListSortKey): SortKeyOption {
  return SORT_KEYS.find((option) => option.key === key) ?? SORT_KEYS[0]!;
}

export function isSortKey(value: unknown): value is EntityListSortKey {
  return SORT_KEYS.some((option) => option.key === value);
}

/** A stored sort with an unknown key or direction reads as the default. */
export function normalizeSort(value: unknown): EntityListSort {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SORT };
  const { key, dir } = value as { key?: unknown; dir?: unknown };
  if (!isSortKey(key)) return { ...DEFAULT_SORT };
  return { key, dir: dir === 'asc' || dir === 'desc' ? dir : sortKeyOption(key).defaultDir };
}

export interface SortContext {
  /** Epoch ms of the last open in this browser, or undefined. */
  openedAt?: (id: string) => number | undefined;
  /** Display name for a principal IRI, or undefined while unknown. */
  nameOf?: (iri: string) => string | null | undefined;
}

function timeOf(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function valueOf(entity: SortableEntity, key: EntityListSortKey, context: SortContext): string | number | undefined {
  switch (key) {
    case 'name':
      return entity.name;
    case 'modified':
      return timeOf(entity.dateModified);
    case 'created':
      return timeOf(entity.dateCreated);
    case 'opened':
      return context.openedAt?.(entity.id);
    case 'creator': {
      const iri = entity.createdBy;
      if (!iri) return undefined;
      return context.nameOf?.(iri) ?? iri;
    }
    case 'versions':
      return entity.currentVersionNumber ?? undefined;
  }
}

function byName(a: SortableEntity, b: SortableEntity): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** A comparator for `sort`. The input order does not matter: ties fall back to name. */
export function compareEntities(sort: EntityListSort, context: SortContext = {}) {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return (a: SortableEntity, b: SortableEntity): number => {
    const va = valueOf(a, sort.key, context);
    const vb = valueOf(b, sort.key, context);
    if (va === undefined && vb === undefined) return byName(a, b);
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    let order: number;
    if (typeof va === 'string' && typeof vb === 'string') {
      order = va.localeCompare(vb, undefined, { sensitivity: 'base' });
    } else {
      order = (va as number) - (vb as number);
    }
    return order !== 0 ? order * sign : byName(a, b);
  };
}

export function sortEntities<T extends SortableEntity>(rows: readonly T[], sort: EntityListSort, context: SortContext = {}): T[] {
  return rows.slice().sort(compareEntities(sort, context));
}
