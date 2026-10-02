import { createEntityUtilsWithFields } from './EntityUtils.js';
import { QueryVersionSchema, type QueryVersionEntity } from '../schemas/QueryVersionSchema.js';
import { assertMutableEntity } from '../../lib/immutability.js';

const QueryVersionUtils = createEntityUtilsWithFields<QueryVersionEntity>(
  QueryVersionSchema,
  'QueryVersion'
);

export const QueryVersions = QueryVersionUtils.Repository;
export const createQueryVersion = QueryVersionUtils.create;
export async function updateQueryVersion(id: string, updates: Partial<QueryVersionEntity>): Promise<void> { // note: should generally be avoided (immutable)
  const existing = await findQueryVersionById(id);
  assertMutableEntity('QueryVersion', existing as Record<string, unknown> | null, updates as Record<string, unknown>);
  return QueryVersionUtils.update(id, updates);
}
export const deleteQueryVersion = QueryVersionUtils.delete; // note: should generally be avoided (immutable)
export const findAllQueryVersions = QueryVersionUtils.findAll;
export const findQueryVersionById = QueryVersionUtils.findById;

export async function listVersionsForQuery(queryId: string): Promise<QueryVersionEntity[]> {
  const all = await QueryVersionUtils.findAll();
  return all
    .filter(v => v.isPartOf === queryId)
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
}

export async function loadQueryVersionsByIds(ids: string[]): Promise<QueryVersionEntity[]> {
  const out: QueryVersionEntity[] = [];
  for (const id of ids) {
    const item = await findQueryVersionById(id);
    if (item) out.push(item);
  }
  return out;
}
