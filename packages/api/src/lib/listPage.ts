/**
 * Paging, filtering and sorting for the collection routes (#197).
 *
 * A list route without `limit` answers with every readable entity, as before.
 * With `limit`, it answers with one page and puts the number of matches in the
 * `X-Total-Count` header. The body stays an array, so a client that does not
 * page reads the same shape.
 *
 * - `q` keeps the entities whose name holds the characters of `q` in order,
 *   ignoring case. The web filters names with the same rule (`lib/fuzzy.ts`).
 * - `ids` keeps the named entities only. The rail loads its pinned rows this way.
 * - `library` keeps the entities in that library.
 * - `tag` keeps the entities that carry the named tags: every one of them, or
 *   at least one with `tagMatch=any`.
 * - `withTag` keeps the entities that also carry every named tag. A tag
 *   heading in the rail loads its rows this way, inside the tag filter.
 * - `sort` and `order` order the matches before the page is cut. A row with no
 *   value for the key sorts last in either order, and ties fall back to the name.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

export const LIST_SORT_KEYS = ['name', 'modified', 'created', 'creator', 'versions'] as const;
export type ListSortKey = (typeof LIST_SORT_KEYS)[number];

/** The largest page a caller can ask for. */
export const MAX_LIST_LIMIT = 500;

export const TOTAL_COUNT_HEADER = 'x-total-count';

/** Query-string properties every paged list route accepts. */
export const listPageQueryProperties = {
  limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_LIMIT },
  offset: { type: 'integer', minimum: 0 },
  q: { type: 'string' },
  ids: { type: 'array', items: { type: 'string' } },
  library: { type: 'string' },
  tag: { type: 'array', items: { type: 'string' } },
  tagMatch: { type: 'string', enum: ['any', 'all'] },
  withTag: { type: 'array', items: { type: 'string' } },
  sort: { type: 'string', enum: [...LIST_SORT_KEYS] },
  order: { type: 'string', enum: ['asc', 'desc'] },
} as const;

type QuerySchema = { properties?: Record<string, unknown> } & Record<string, unknown>;
type PropertiesOf<T> = T extends { properties: infer P } ? P : unknown;

/**
 * Add the paging properties to a route's query-string schema. The type keeps
 * the route's own properties, so a handler still reads them typed.
 */
export function withListPageQuery<T extends QuerySchema | undefined>(
  querystring: T,
): Omit<NonNullable<T>, 'properties'> & {
  type: 'object';
  properties: typeof listPageQueryProperties & PropertiesOf<T>;
} {
  const existing = (querystring ?? {}) as QuerySchema;
  return {
    type: 'object',
    ...existing,
    // A route's own property of the same name wins: it already answers it.
    properties: { ...listPageQueryProperties, ...(existing.properties ?? {}) },
  } as never;
}

export interface ListPageQuery {
  limit?: number;
  offset: number;
  q?: string;
  ids?: string[];
  library?: string;
  tags?: string[];
  /** How `tags` combine. Default `all`. */
  tagMatch?: 'any' | 'all';
  /** Tags every row must also carry, whatever `tagMatch` says. */
  withTags?: string[];
  sort?: ListSortKey;
  order?: 'asc' | 'desc';
}

function asList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const items = Array.isArray(value) ? value : [value];
  const strings = items.map((item) => String(item)).filter(Boolean);
  return strings.length > 0 ? strings : undefined;
}

function asInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}

export function parseListPageQuery(request: FastifyRequest): ListPageQuery {
  const raw = (request.query ?? {}) as Record<string, unknown>;
  const limit = asInteger(raw.limit);
  const offset = asInteger(raw.offset) ?? 0;
  const sort = LIST_SORT_KEYS.includes(raw.sort as ListSortKey) ? (raw.sort as ListSortKey) : undefined;
  const order = raw.order === 'asc' || raw.order === 'desc' ? raw.order : undefined;
  return {
    ...(limit !== undefined ? { limit: Math.min(Math.max(limit, 1), MAX_LIST_LIMIT) } : {}),
    offset: Math.max(offset, 0),
    ...(typeof raw.q === 'string' && raw.q.trim() ? { q: raw.q.trim() } : {}),
    ...(asList(raw.ids) ? { ids: asList(raw.ids) } : {}),
    ...(typeof raw.library === 'string' && raw.library ? { library: raw.library } : {}),
    ...(asList(raw.tag) ? { tags: asList(raw.tag) } : {}),
    ...(raw.tagMatch === 'any' ? { tagMatch: 'any' as const } : {}),
    ...(asList(raw.withTag) ? { withTags: asList(raw.withTag) } : {}),
    ...(sort ? { sort } : {}),
    ...(order ? { order } : {}),
  };
}

/** True when the request asks for any of the list controls. */
export function asksForPaging(query: ListPageQuery): boolean {
  return query.limit !== undefined
    || query.offset > 0
    || query.q !== undefined
    || query.ids !== undefined
    || query.library !== undefined
    || query.tags !== undefined
    || query.withTags !== undefined
    || query.sort !== undefined;
}

/** The fields the controls read. Stored entities and summaries both have them. */
export interface ListableEntity {
  $id?: string;
  id?: string;
  name?: unknown;
  isPartOf?: unknown;
  libraryId?: unknown;
  libraryIds?: unknown;
  tags?: unknown;
  dateCreated?: unknown;
  dateModified?: unknown;
  createdBy?: unknown;
}

export interface ListPageOptions<T> {
  /** The current version number, for `sort=versions`. */
  versionOf?: (entity: T) => number | undefined;
  /** Rows that go before the others, each part in the sorted order. */
  first?: (entity: T) => boolean;
}

export interface ListPage<T> {
  items: T[];
  total: number;
}

const idOf = (entity: ListableEntity): string => String(entity.$id ?? entity.id ?? '');
const nameOf = (entity: ListableEntity): string => (typeof entity.name === 'string' ? entity.name : '');

function toStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return typeof value === 'string' && value ? [value] : [];
}

/** Every character of `query` appears in `name` in order, ignoring case. */
export function nameMatches(query: string, name: string): boolean {
  const needle = query.toLowerCase().replace(/\s+/g, '');
  const haystack = name.toLowerCase();
  let at = 0;
  for (const char of needle) {
    at = haystack.indexOf(char, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

function timeOf(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function byName(a: ListableEntity, b: ListableEntity): number {
  return nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' });
}

function sortValue<T extends ListableEntity>(
  entity: T,
  key: ListSortKey,
  options: ListPageOptions<T>,
): string | number | undefined {
  switch (key) {
    case 'name':
      return nameOf(entity);
    case 'modified':
      return timeOf(entity.dateModified);
    case 'created':
      return timeOf(entity.dateCreated);
    case 'creator':
      return typeof entity.createdBy === 'string' && entity.createdBy ? entity.createdBy : undefined;
    case 'versions':
      return options.versionOf?.(entity);
  }
}

const DEFAULT_ORDER: Record<ListSortKey, 'asc' | 'desc'> = {
  name: 'asc',
  modified: 'desc',
  created: 'desc',
  creator: 'asc',
  versions: 'desc',
};

/** Filter, sort and cut one page. */
export function applyListPage<T extends ListableEntity>(
  entities: readonly T[],
  query: ListPageQuery,
  options: ListPageOptions<T> = {},
): ListPage<T> {
  let matches = [...entities];
  if (query.ids) {
    const wanted = new Set(query.ids);
    matches = matches.filter((entity) => wanted.has(idOf(entity)));
  }
  if (query.library) {
    const library = query.library;
    matches = matches.filter((entity) =>
      toStrings(entity.isPartOf).includes(library)
      || toStrings(entity.libraryId).includes(library)
      || toStrings(entity.libraryIds).includes(library));
  }
  if (query.tags) {
    const tags = query.tags;
    matches = matches.filter((entity) => {
      const carried = toStrings(entity.tags);
      return query.tagMatch === 'any'
        ? tags.some((tag) => carried.includes(tag))
        : tags.every((tag) => carried.includes(tag));
    });
  }
  if (query.withTags) {
    const tags = query.withTags;
    matches = matches.filter((entity) => {
      const carried = toStrings(entity.tags);
      return tags.every((tag) => carried.includes(tag));
    });
  }
  if (query.q) {
    const q = query.q;
    matches = matches.filter((entity) => nameMatches(q, nameOf(entity)));
  }

  if (query.sort) {
    const key = query.sort;
    const sign = (query.order ?? DEFAULT_ORDER[key]) === 'asc' ? 1 : -1;
    const values = new Map<T, string | number | undefined>();
    for (const entity of matches) values.set(entity, sortValue(entity, key, options));
    matches.sort((a, b) => {
      const va = values.get(a);
      const vb = values.get(b);
      if (va === undefined && vb === undefined) return byName(a, b);
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      const order = typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb, undefined, { sensitivity: 'base' })
        : (va as number) - (vb as number);
      return order !== 0 ? order * sign : byName(a, b);
    });
  }

  if (options.first) {
    const first = options.first;
    matches = [...matches.filter((entity) => first(entity)), ...matches.filter((entity) => !first(entity))];
  }

  const total = matches.length;
  const end = query.limit !== undefined ? query.offset + query.limit : undefined;
  return { items: matches.slice(query.offset, end), total };
}

/** Set the total on a paged answer. */
export function sendTotal(reply: FastifyReply, total: number): void {
  reply.header(TOTAL_COUNT_HEADER, String(total));
}

/** Add the paging properties to a route schema's query string. */
export function withListPage<S extends object>(schema: S): S {
  const querystring = (schema as { querystring?: QuerySchema }).querystring;
  return { ...schema, querystring: withListPageQuery(querystring) } as S;
}

/**
 * The one way a list route answers (#197): filter, sort and cut the page,
 * set `X-Total-Count`, and present the page only.
 */
export function sendListPage<T extends ListableEntity, R>(
  request: FastifyRequest,
  reply: FastifyReply,
  entities: readonly T[],
  present: (entity: T) => R,
  options: ListPageOptions<T> = {},
): FastifyReply {
  const page = applyListPage(entities, parseListPageQuery(request), options);
  sendTotal(reply, page.total);
  return reply.send(page.items.map(present));
}
