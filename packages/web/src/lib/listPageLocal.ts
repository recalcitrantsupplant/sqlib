/**
 * The list controls of the API's `lib/listPage.ts`, applied in the browser.
 *
 * A server answers a paged list with `X-Total-Count` (#197). An answer
 * without it comes from a server that ignored the controls and sent the whole
 * list: an older API, or a test's mock. The client then filters, sorts and
 * cuts the page itself, so the screen reads the same either way.
 */
import { fuzzyMatches } from './fuzzy';
import type { ListPage, ListPageParams } from '../composables/useApiClient';

type Row = Record<string, unknown> & { id: string };

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : typeof value === 'string' && value ? [value] : [];

const nameOf = (row: Row) => (typeof row.name === 'string' ? row.name : '');

function timeOf(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function sortValue(row: Row, key: NonNullable<ListPageParams['sort']>): string | number | undefined {
  switch (key) {
    case 'name': return nameOf(row);
    case 'modified': return timeOf(row.dateModified);
    case 'created': return timeOf(row.dateCreated);
    case 'creator': return typeof row.createdBy === 'string' && row.createdBy ? row.createdBy : undefined;
    case 'versions': return typeof row.currentVersionNumber === 'number' ? row.currentVersionNumber : undefined;
  }
}

const DEFAULT_ORDER: Record<NonNullable<ListPageParams['sort']>, 'asc' | 'desc'> = {
  name: 'asc', modified: 'desc', created: 'desc', creator: 'asc', versions: 'desc',
};

export function applyListPageLocally<T>(all: T[], params: ListPageParams): ListPage<T> {
  let rows = all as unknown as Row[];
  if (params.ids) {
    const wanted = new Set(params.ids);
    rows = rows.filter((row) => wanted.has(row.id));
  }
  if (params.library) {
    const library = params.library;
    rows = rows.filter((row) =>
      [row.isPartOf, row.libraryId, row.libraryIds].some((value) => strings(value).includes(library)));
  }
  if (params.tag?.length) {
    const tags = params.tag;
    rows = rows.filter((row) => tags.every((tag) => strings(row.tags).includes(tag)));
  }
  if (params.q?.trim()) {
    const q = params.q;
    rows = rows.filter((row) => fuzzyMatches(q, nameOf(row)));
  }
  if (params.sort) {
    const key = params.sort;
    const sign = (params.order ?? DEFAULT_ORDER[key]) === 'asc' ? 1 : -1;
    const byName = (a: Row, b: Row) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' });
    rows = [...rows].sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      if (va === undefined && vb === undefined) return byName(a, b);
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      const order = typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb, undefined, { sensitivity: 'base' })
        : (va as number) - (vb as number);
      return order !== 0 ? order * sign : byName(a, b);
    });
  }
  const offset = params.offset ?? 0;
  const end = params.limit !== undefined ? offset + params.limit : undefined;
  return { items: rows.slice(offset, end) as unknown as T[], total: rows.length };
}
